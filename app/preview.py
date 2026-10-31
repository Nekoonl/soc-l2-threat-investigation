"""Reproducible, bounded SOC previews. Only SELECTs; all results stay in memory."""
import hashlib
import ipaddress
import json
import sqlite3
from collections import Counter

from . import storage
from .detection import RULES, auth_result, correlate, detect
from .event_view import SOURCE_COLUMNS, source_field
from .ingestion import FIELDS, key
from .time_policy import RelativeClockScope, TimePolicy, read_source_time

ENGINE_VERSION = 'soc-preview-1'
MAX_PREVIEW_EVENTS = 10_000
MAX_PREVIEW_ALERTS = 1_000
RELATIVE_ASSUMPTION = ('El analista supone que los relojes de los eventos sin zona de este dataset son comparables '
                       'durante el intervalo analizado. Esta hipótesis no demuestra sincronización ni establece una zona horaria.')
RULE_FIELDS = {
    'AUTH-001': ['Timestamp', 'Source_IP', 'User', 'Hostname', 'Event_ID / Result'],
    'AUTH-002': ['Timestamp', 'Source_IP', 'User', 'Hostname', 'Event_ID / Result'],
    'AUTH-003': ['Timestamp', 'Source_IP', 'User', 'Event_ID / Result'],
    'NET-001': ['Timestamp', 'Source_IP', 'IP de destino', 'Puerto de destino estructurado'],
    'EXEC-001': ['Event_ID / contexto PowerShell', 'Event_Description / Process_CommandLine / message'],
}
RISK_REASONS = {
    'AUTH-001': 'Repetición de fallos sobre la misma identidad y host; posible intento automatizado.',
    'AUTH-002': 'Un éxito después del umbral de fallos eleva la prioridad de validar el acceso.',
    'AUTH-003': 'Fallos desde un origen contra varias cuentas; posible ataque distribuido entre identidades.',
    'NET-001': 'Diversidad de puertos hacia un destino; posible reconocimiento o escaneo autorizado.',
    'EXEC-001': 'PowerShell combinado con un indicador de codificación, descarga o ejecución dinámica.',
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def raw_value(event, field):
    if field in SOURCE_COLUMNS:
        _, value = source_field(event['raw'], field, event.get('source_columns'))
        return value or ''
    candidates = {key(alias) for alias in FIELDS[field]}
    return next((str(value or '') for header, value in event['raw'].items() if key(header) in candidates), '')


def valid_ip(value):
    if value.strip().lower() in ('', '-', '::', '0.0.0.0', 'n/a', 'na', 'null', 'none', 'unknown'):
        return ''
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return ''


def adapt_event(event):
    """Adapt preserved evidence; no inference of ports, DNS, commands or source zones."""
    view = dict(event)
    for field in ('username', 'hostname'):
        view[field] = raw_value(event, field).strip().lower()
    view['src_ip'] = valid_ip(raw_value(event, 'src_ip'))
    view['dst_ip'] = valid_ip(raw_value(event, 'dst_ip')) or valid_ip(raw_value(event, 'destination'))
    view['event_id'] = raw_value(event, 'event_id').strip().removesuffix('.0')
    view['event_type'] = raw_value(event, 'event_type').strip()
    view['status'] = raw_value(event, 'status').strip()
    parts = dict.fromkeys(raw_value(event, field).strip() for field in ('event_description', 'process_commandline', 'message'))
    view['message'] = '\n'.join(part for part in parts if part)
    try:
        port = int(raw_value(event, 'dst_port').strip())
        view['dst_port'] = port if 0 < port <= 65535 else 0
    except ValueError:
        view['dst_port'] = 0
    return view


def fields_available(event, rule_id):
    if rule_id in ('AUTH-001', 'AUTH-002', 'AUTH-003'):
        result = auth_result(event)
        return bool(event['src_ip'] and event['username'] and
                    (rule_id == 'AUTH-003' or event['hostname']) and
                    (result in ('failure', 'success') if rule_id == 'AUTH-002' else result == 'failure'))
    if rule_id == 'NET-001':
        return bool(event['src_ip'] and event['dst_ip'] and event['dst_port'])
    return bool(event['message'])


def run_preview(*, assume_comparable_clocks=False):
    if type(assume_comparable_clocks) is not bool:
        raise ValueError('La hipótesis temporal debe ser un booleano explícito.')
    try:
        with storage.readonly_connection() as db:
            total = db.execute('SELECT COUNT(*) FROM events e JOIN imports i ON i.id=e.import_id WHERE i.synthetic=0').fetchone()[0]
            if total > MAX_PREVIEW_EVENTS:
                raise ValueError(f'La vista previa admite hasta {MAX_PREVIEW_EVENTS:,} eventos. No se ejecutó ni guardó un análisis parcial.')
            originals = storage.soc_event_rows(db, real_only=True)
            revision = storage.dataset_revision(db)
            stored_cases = db.execute('SELECT COUNT(*) FROM incidents').fetchone()[0]
            excluded_synthetic = db.execute('SELECT COUNT(*) FROM events e JOIN imports i ON i.id=e.import_id WHERE i.synthetic=1').fetchone()[0]
    except sqlite3.Error as exc:
        raise ValueError('No se pudo leer SQLite para la vista previa. Comprueba el backend y la base existente; no se creó ni modificó ninguna base.') from exc

    dataset_hash = digest(originals)
    events = [adapt_event(event) for event in originals]
    unknown_ids = frozenset(event['id'] for event in events if read_source_time(event).status == 'unknown')
    scope = RelativeClockScope('dataset-' + dataset_hash, unknown_ids, RELATIVE_ASSUMPTION) if assume_comparable_clocks and unknown_ids else None
    policy = TimePolicy(scope)
    by_id = {event['id']: event for event in events}
    manifest = {'dataset_sha256': dataset_hash, 'engine_version': ENGINE_VERSION, 'rules': RULES,
                'assume_comparable_clocks': assume_comparable_clocks, 'relative_assumption': RELATIVE_ASSUMPTION if scope else None}
    preview_id = 'PREV-' + digest(manifest)[:24].upper()
    findings = detect(events, time_policy=policy)
    findings = [item for item in findings if all(fields_available(by_id[eid], item['rule_id']) for eid in item['evidence_ids'])]
    if len(findings) > MAX_PREVIEW_ALERTS:
        raise ValueError(f'La vista previa supera {MAX_PREVIEW_ALERTS:,} alertas. No se guardaron ni truncaron resultados.')
    for item in findings:
        item['id'] = 'ALR-' + digest([preview_id, item['rule_id'], item['evidence_ids']])[:20].upper()
        item['analyst_status'] = 'pending_review'
        item['hypothesis'] = f"Actividad compatible con {item['title'].lower()}; requiere validación del analista."
        item['depends_on_clock_assumption'] = item['rule_id'] != 'EXEC-001' and item['time_basis']['kind'] == 'relative'
        item['risk_reason'] = (f"Prioridad heurística fija de la regla: {item['score']}/100. " + RISK_REASONS[item['rule_id']]
                              + f" Evidencia asociada: {item['event_count']} evento(s). No es probabilidad de compromiso ni Severity del archivo.")
    links = correlate(findings, by_id, time_policy=policy)
    for item in findings:
        item['related'] = [{**link, 'depends_on_clock_assumption': item['time_basis']['kind'] == 'relative'} for link in links[item['id']]]

    counts = Counter(item['rule_id'] for item in findings)
    risk_counts = Counter(item['severity'] for item in findings)
    coverage = []
    for rule in RULES:
        eligible = [event for event in events if fields_available(event, rule['id'])]
        temporal = rule['id'] != 'EXEC-001'
        evaluated = sum(not temporal or policy.point(event) is not None for event in eligible)
        missing_time = len(eligible) - evaluated
        missing_fields = len(events) - len(eligible)
        status = 'not_evaluated' if not evaluated else 'partial' if evaluated != len(events) else 'evaluated'
        reason = ('Sin eventos almacenados.' if not events else
                  'Sin eventos evaluables con los campos y la base temporal requeridos.' if not evaluated else
                  'Cobertura limitada a los eventos con campos y base temporal disponibles.' if temporal else
                  'Indicador individual; no necesita intervalo temporal.')
        if events and rule['id'] == 'NET-001' and not eligible:
            reason = 'Faltan combinaciones válidas de IP origen/destino y puerto estructurado; no se infieren puertos del texto.'
        elif eligible and not evaluated and missing_time:
            reason = f'Se omitieron {missing_time} eventos aplicables por falta de base temporal comparable.'
        coverage.append({**rule, 'fields': RULE_FIELDS[rule['id']], 'temporal': temporal,
                         'evaluated_events': evaluated, 'omitted_temporal_events': missing_time,
                         'omitted_context_events': missing_fields, 'alerts': counts[rule['id']], 'status': status, 'reason': reason})

    used_ids = {eid for item in findings for eid in item['evidence_ids']}
    return {'schema_version': 1, 'preview_id': preview_id, 'engine_version': ENGINE_VERSION, 'read_only': True,
            'dataset': {'sha256': dataset_hash, 'revision': revision, 'event_count': len(events), 'stored_incident_count': stored_cases,
                        'excluded_synthetic_count': excluded_synthetic, 'unknown_timezone_count': len(unknown_ids),
                        'absolute_time_count': sum(read_source_time(event).status == 'known' for event in events),
                        'unverified_time_count': sum(read_source_time(event).status == 'unverified' for event in events)},
            'options': {'assume_comparable_clocks': assume_comparable_clocks,
                        'relative_scope_count': len(unknown_ids) if scope else 0, 'assumption': RELATIVE_ASSUMPTION if scope else None},
            'counts': {'alerts': len(findings), 'correlations': sum(len(item['related']) for item in findings) // 2,
                       'by_risk': {risk: risk_counts[risk] for risk in ('critical', 'high', 'medium', 'low')},
                       'by_rule': {rule['id']: counts[rule['id']] for rule in RULES}},
            'coverage': coverage, 'alerts': findings,
            'evidence': [event for event in originals if event['id'] in used_ids]}
