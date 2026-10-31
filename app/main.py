import asyncio
import csv
import io
import json
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import storage
from .analysis import analyze_with_ollama, guided_analysis
from .config import MAX_UPLOAD, OLLAMA_MODEL, ROOT, TIMEZONE
from .detection import RULES
from .ingestion import FIELDS, normalize, read_table, suggest_mapping
from .reports import make_report
from .preview import run_preview
from .dashboard import get_dashboard_summary
from .preview_store import remember
from .report_data import build_report_data

ANALYSIS_SEMAPHORE = asyncio.Semaphore(1)
PREVIEW_SEMAPHORE = asyncio.Semaphore(1)
REPORT_SEMAPHORE = asyncio.Semaphore(1)


async def json_body(request):
    body = await request.json()
    if not isinstance(body, dict):
        raise ValueError('Se requiere un objeto JSON.')
    return body


class LocalSecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        method = scope['method']
        if method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            origin = headers.get(b'origin')
            expected = scope.get('scheme', 'http').encode() + b'://' + headers.get(b'host', b'')
            if (origin and origin != expected) or headers.get(b'sec-fetch-site') == b'cross-site':
                return await JSONResponse({'error': 'Origen de solicitud no permitido.'}, status_code=403)(scope, receive, send)
        length = headers.get(b'content-length', b'0')
        if not length.isdigit() or int(length) > MAX_UPLOAD + 1024 * 1024:
            return await JSONResponse({'error': 'La solicitud supera el límite de tamaño.'}, status_code=413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get('body', b''))
            if received > MAX_UPLOAD + 1024 * 1024:
                raise HTTPException(413, 'La solicitud supera el límite de tamaño.')
            return message

        async def secured_send(message):
            if message['type'] == 'http.response.start':
                message.setdefault('headers', []).extend([
                    (b'x-content-type-options', b'nosniff'), (b'x-frame-options', b'DENY'),
                    (b'referrer-policy', b'no-referrer'), (b'cache-control', b'no-store'),
                    (b'content-security-policy', b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"),
                ])
            await send(message)
        await self.app(scope, bounded_receive, secured_send)


@asynccontextmanager
async def lifespan(app):
    storage.initialize()
    yield


async def index(request):
    return FileResponse(ROOT / 'static' / 'index.html')


async def health(request):
    return JSONResponse({'status': 'ok', 'app': 'SOC L2', 'version': '1.0.0', 'timezone': TIMEZONE})


async def dashboard_summary(request):
    return JSONResponse(await run_in_threadpool(get_dashboard_summary))


async def overview(request):
    data = await run_in_threadpool(storage.snapshot)
    events = data.pop('events')
    if events:
        times = [datetime.fromisoformat(e['timestamp']).timestamp() for e in events]
        start, end = min(times), max(times)
        width = max((end - start + 1) / 24, 60)
        bins = [{'timestamp': datetime.fromtimestamp(start + i * width, timezone.utc).isoformat(), 'events': 0, 'flagged': 0} for i in range(24)]
        flagged = {eid for item in data['incidents'] for eid in item['evidence_ids']}
        for event, when in zip(events, times):
            bin_ = bins[min(int((when - start) / width), 23)]
            bin_['events'] += 1
            bin_['flagged'] += int(event['id'] in flagged)
        data['timeline'] = bins
        sources = Counter(e['src_ip'] for e in events if e['src_ip'])
        data['top_sources'] = [{'ip': ip, 'count': count} for ip, count in sources.most_common(5)]
        data['range'] = {'start': min(e['timestamp'] for e in events), 'end': max(e['timestamp'] for e in events)}
    else:
        data.update(timeline=[], top_sources=[], range=None)
    data.update(ai_configured=bool(OLLAMA_MODEL), ai_model=OLLAMA_MODEL or None, timezone=TIMEZONE, rules=RULES)
    return JSONResponse(data)


async def events_api(request):
    query = request.query_params.get('q', '')
    if len(query) > 200:
        raise ValueError('La búsqueda admite hasta 200 caracteres.')
    try:
        page = max(1, int(request.query_params.get('page', '1')))
        page_size = int(request.query_params.get('page_size', '50'))
        import_id = int(request.query_params['import_id']) if request.query_params.get('import_id') else None
    except ValueError:
        raise ValueError('Página, tamaño o identificador de importación no válido.')
    if page_size not in (10, 25, 50, 100) or (import_id is not None and import_id < 1):
        raise ValueError('Tamaño de página o importación fuera de rango.')
    filters = {field: request.query_params.get(field, '') for field in ('log_source', 'hostname', 'status', 'source_severity')}
    if any(len(value) > 200 for value in filters.values()):
        raise ValueError('Un filtro supera el límite de 200 caracteres.')
    filters['import_id'] = import_id
    result = await run_in_threadpool(storage.query_events, query=query, page=page, page_size=page_size,
                                    filters=filters, real_only=request.query_params.get('real_only') == '1')
    return JSONResponse(result)


async def event_options(request):
    return JSONResponse(await run_in_threadpool(storage.event_filter_options))


async def event_detail(request):
    event = await run_in_threadpool(storage.get_event, request.path_params['event_id'])
    if event is None:
        raise HTTPException(404, 'Evento no encontrado.')
    return JSONResponse(event)


async def detection_preview(request):
    body = await json_body(request)
    if set(body) - {'assume_comparable_clocks'}:
        raise ValueError('La vista previa solo acepta la opción temporal; no admite guardar ni modificar datos.')
    assumption = body.get('assume_comparable_clocks', False)
    if type(assumption) is not bool:
        raise ValueError('La hipótesis de relojes comparables debe ser true o false.')
    async with PREVIEW_SEMAPHORE:
        result = await run_in_threadpool(run_preview, assume_comparable_clocks=assumption)
        await run_in_threadpool(remember, result)
    return JSONResponse(result)


async def upload(request, preview=False):
    async with request.form(max_files=1, max_fields=3, max_part_size=MAX_UPLOAD) as form:
        file = form.get('file')
        if file is None or not hasattr(file, 'read'):
            raise ValueError('Selecciona un archivo CSV o Excel.')
        content = await file.read(MAX_UPLOAD + 1)
        filename = str(file.filename or 'logs.csv').replace('\\', '/').split('/')[-1]
        if not filename or len(filename) > 255:
            raise ValueError('El nombre de archivo debe contener entre 1 y 255 caracteres.')
        headers, rows = await run_in_threadpool(read_table, filename, content)
        source_timezone = form.get('source_timezone') or None
        if source_timezone not in (None, 'UTC', 'America/Panama'):
            raise ValueError('Zona horaria no admitida. Conserva la zona sin indicar o declara UTC / America/Panama.')
        if preview:
            return JSONResponse({'headers': headers, 'rows': [[str(v) if v is not None else '' for v in row] for row in rows[:5]],
                                 'total': len(rows), 'mapping': suggest_mapping(headers), 'fields': list(FIELDS), 'timezone': source_timezone})
        raw_mapping = form.get('mapping')
        if raw_mapping is not None:
            try:
                mapping = json.loads(str(raw_mapping))
            except json.JSONDecodeError:
                raise ValueError('Mapeo JSON no válido.')
        else:
            mapping = None
        events, errors, mapping = await run_in_threadpool(normalize, headers, rows, mapping, source_timezone)
        result = await run_in_threadpool(storage.save_import, filename, content, events, errors, mapping,
                                        run_detection=False, source_timezone=source_timezone,
                                        sheet_name=getattr(rows[0], 'sheet_name', None))
        result['unmapped_columns'] = [header for header in headers if header not in mapping.values()]
        if not events:
            return JSONResponse({**result, 'error': 'No hay filas válidas. El original y el resultado se conservaron; revisa los errores.'}, status_code=422)
        return JSONResponse(result, status_code=201)


async def preview_upload(request):
    return await upload(request, preview=True)


async def demo(request):
    content = (ROOT / 'samples' / 'escenario_soc.csv').read_bytes()
    headers, rows = read_table('escenario_soc.csv', content)
    events, errors, mapping = normalize(headers, rows)
    result = await run_in_threadpool(storage.save_import, 'escenario_soc.csv [DEMO]', content, events, errors, mapping, True)
    return JSONResponse(result, status_code=201)


async def reset_demo(request):
    body = await json_body(request)
    if body.get('confirmation') != 'REINICIAR DEMO':
        raise ValueError('Confirma el reinicio del laboratorio demo.')
    await run_in_threadpool(storage.reset_demo)
    return JSONResponse({'ok': True})


async def incident(request):
    incident_id = request.path_params['incident_id']
    if request.method == 'PATCH':
        body = await json_body(request)
        await run_in_threadpool(storage.update_incident, incident_id, body.get('status'), body.get('notes', ''))
    item = await run_in_threadpool(storage.get_incident, incident_id)
    if item is None:
        raise HTTPException(404, 'Incidente no encontrado.')
    return JSONResponse(item)


async def analysis(request):
    item = await run_in_threadpool(storage.get_incident, request.path_params['incident_id'])
    if item is None:
        raise HTTPException(404, 'Incidente no encontrado.')
    body = await json_body(request)
    provider = body.get('provider', 'guided')
    if provider not in ('guided', 'ollama'):
        raise ValueError('Proveedor no válido.')
    async with ANALYSIS_SEMAPHORE:
        result = await run_in_threadpool(analyze_with_ollama if provider == 'ollama' else guided_analysis, item)
        await run_in_threadpool(storage.save_analysis, item['id'], result, item['evidence_ids'])
    return JSONResponse(result)


async def report(request):
    kind = request.path_params['kind']
    if kind not in ('technical', 'executive'):
        raise HTTPException(404, 'Tipo de informe no válido.')
    body = await json_body(request) if request.method == 'POST' else {}
    if set(body) - {'preview_id', 'dataset_revision'}:
        raise ValueError('El informe solo acepta referencias de dataset y vista previa; no acepta hallazgos, evidencias ni opciones de recálculo.')
    for field in ('preview_id', 'dataset_revision'):
        if body.get(field) is not None and (not isinstance(body[field], str) or not body[field] or len(body[field]) > 100):
            raise ValueError('La referencia de informe no es válida.')
    async with REPORT_SEMAPHORE:
        data = await run_in_threadpool(build_report_data, preview_id=body.get('preview_id'),
                                       expected_revision=body.get('dataset_revision'), allow_demo=request.method == 'GET')
        result = await run_in_threadpool(make_report, data, kind)
    return Response(result, media_type='application/pdf', headers={
        'Content-Disposition': f'attachment; filename="SOC-L2-{kind}.pdf"',
        'X-SOC-Dataset-Revision': data['summary']['dataset_revision'],
        'X-SOC-Preview-ID': data['preview']['preview_id'] if data['preview'] else '',
    })


async def template(request):
    content = 'timestamp,src_ip,dst_ip,username,hostname,event_type,event_id,status,dst_port,bytes_sent,message\r\n2026-10-28T09:00:00-05:00,192.0.2.10,10.0.0.10,usuario,pc-01,login,4625,failure,3389,0,Intento de acceso fallido\r\n'
    return Response(content.encode('utf-8-sig'), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="plantilla-logs.csv"'})


async def demo_file(request):
    return FileResponse(ROOT / 'samples' / 'escenario_soc.csv', filename='escenario_soc.csv', media_type='text/csv')


async def error_response(request, exc):
    status = exc.status_code if isinstance(exc, HTTPException) else 404 if isinstance(exc, LookupError) else 422
    return JSONResponse({'error': str(exc.detail) if isinstance(exc, HTTPException) else str(exc)}, status_code=status)


routes = [Route('/', index), Route('/api/health', health), Route('/api/overview', overview), Route('/api/events', events_api),
          Route('/api/dashboard/summary', dashboard_summary),
          Route('/api/detections/preview', detection_preview, methods=['POST']),
          Route('/api/events/options', event_options), Route('/api/events/{event_id:int}', event_detail),
          Route('/api/import/preview', preview_upload, methods=['POST']), Route('/api/import', upload, methods=['POST']),
          Route('/api/demo', demo, methods=['POST']), Route('/api/demo/reset', reset_demo, methods=['POST']),
          Route('/api/incidents/{incident_id}', incident, methods=['GET', 'PATCH']),
          Route('/api/incidents/{incident_id}/analysis', analysis, methods=['POST']),
          Route('/api/reports/{kind}.pdf', report, methods=['GET', 'POST']), Route('/api/template.csv', template), Route('/api/demo.csv', demo_file),
          Mount('/static', app=StaticFiles(directory=ROOT / 'static'), name='static')]
app = Starlette(routes=routes, lifespan=lifespan, middleware=[
    Middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]']), Middleware(LocalSecurityMiddleware)],
    exception_handlers={ValueError: error_response, LookupError: error_response, HTTPException: error_response})
