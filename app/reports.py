"""ReportLab executive/technical exports of source evidence and executed server previews."""
import io
import threading
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

from .storage import now
from .time_policy import read_source_time
from .event_view import SOURCE_COLUMNS, source_field

PRIORITY_LABELS = {'critical': 'Crítica', 'high': 'Alta', 'medium': 'Media', 'low': 'Baja'}
NAVY = colors.HexColor('#162235')
BLUE = colors.HexColor('#285A95')
STROKE = colors.HexColor('#D9E2EC')
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_REPORT_CHARACTERS = 1_000_000
_FONT_LOCK = threading.Lock()


def _register_fonts():
    with _FONT_LOCK:
        root = Path(reportlab.__file__).parent / 'fonts'
        for name, filename in [('SOC-Regular', 'Vera.ttf'), ('SOC-Bold', 'VeraBd.ttf')]:
            if name not in pdfmetrics.getRegisteredFontNames():
                if not (root / filename).is_file():
                    raise ValueError('No se encontró la tipografía local de ReportLab; revisa la instalación antes de generar PDF.')
                pdfmetrics.registerFont(TTFont(name, str(root / filename)))
        pdfmetrics.registerFontFamily('SOC-Regular', normal='SOC-Regular', bold='SOC-Bold')


def original_value(event, header):
    raw = event.get('raw', {})
    canonical = next((field for field, column in SOURCE_COLUMNS.items() if column == header), None)
    if canonical is not None:
        column, value = source_field(raw, canonical, event.get('source_columns'))
        if column is None:
            return 'No indicado en origen'
    elif header in raw:
        value = str(raw[header]) if raw[header] is not None else ''
    else:
        return 'No indicado en origen'
    return value if value.strip() else 'Vacío en el archivo'


def original_time(event):
    source = read_source_time(event)
    zone = ('Zona no indicada' if source.status == 'unknown' else
            'Offset o zona documentada en origen' if source.status == 'known' else 'Zona de origen no verificable')
    return f'{source.original or "No indicado en origen"} | {zone}'


class _Document:
    """Shared escaped text, tables, cover and pagination for both existing PDF kinds."""
    def __init__(self, kind):
        _register_fonts()
        self.kind, self.story, self.characters = kind, [], 0
        self.output = io.BytesIO()
        self.doc = SimpleDocTemplate(self.output, pagesize=A4, leftMargin=1.8*cm, rightMargin=1.8*cm,
                                     topMargin=2*cm, bottomMargin=1.8*cm, pageCompression=0,
                                     title='SOC L2 | Informe ' + ('técnico' if kind == 'technical' else 'ejecutivo'),
                                     author='SOC L2 | Threat Investigation Platform')
        self.styles = {
            'Body': ParagraphStyle('Body', fontName='SOC-Regular', fontSize=9.5, leading=14, textColor=NAVY, spaceAfter=9, splitLongWords=True),
            'Muted': ParagraphStyle('Muted', fontName='SOC-Regular', fontSize=8.3, leading=12, textColor=colors.HexColor('#53657A'), spaceAfter=8, splitLongWords=True),
            'H1': ParagraphStyle('H1', fontName='SOC-Bold', fontSize=17, leading=23, textColor=NAVY, spaceBefore=15, spaceAfter=11, keepWithNext=True),
            'H2': ParagraphStyle('H2', fontName='SOC-Bold', fontSize=11.5, leading=17, textColor=BLUE, spaceBefore=12, spaceAfter=8, keepWithNext=True),
            'Title': ParagraphStyle('Title', fontName='SOC-Bold', fontSize=29, leading=36, textColor=NAVY, spaceAfter=18),
            'Brand': ParagraphStyle('Brand', fontName='SOC-Bold', fontSize=10, leading=16, textColor=BLUE, spaceAfter=12),
            'Code': ParagraphStyle('Code', fontName='SOC-Regular', fontSize=8.5, leading=12, textColor=NAVY, spaceAfter=9, wordWrap='CJK', splitLongWords=True),
            'Cell': ParagraphStyle('Cell', fontName='SOC-Regular', fontSize=8.2, leading=12, textColor=NAVY, splitLongWords=True),
            'Header': ParagraphStyle('Header', fontName='SOC-Bold', fontSize=8.2, leading=12, textColor=colors.white, splitLongWords=True),
        }

    def text(self, value, style):
        text = str(value)
        self.characters += len(text)
        if self.characters > MAX_REPORT_CHARACTERS:
            raise ValueError('El contenido excede el límite de texto del PDF. No se recortaron evidencias; genera un informe de menor alcance.')
        cmap = pdfmetrics.getFont(self.styles[style].fontName).face.charToGlyph
        # Keep source evidence untouched. Unsupported/control characters get visible Unicode escapes.
        visible = ''.join(ch if ch in '\n\r' or (ord(ch) >= 32 and ord(ch) in cmap) else f'\\u{ord(ch):04X}' for ch in text)
        return escape(visible.replace('\r\n', '\n').replace('\r', '\n')).replace('\n', '<br/>')

    def add(self, value, style='Body'):
        text = str(value)
        chunks = [text] if style in ('H1', 'H2', 'Title', 'Brand') else [text[i:i+1800] for i in range(0, len(text), 1800)] or ['']
        for chunk in chunks:
            self.story.append(Paragraph(self.text(chunk, style), self.styles[style]))

    def table(self, rows, widths=None):
        cells = [[Paragraph(self.text(value, 'Header' if index == 0 else 'Cell'), self.styles['Header' if index == 0 else 'Cell']) for value in row] for index, row in enumerate(rows)]
        widths = [self.doc.width * part for part in widths] if widths else None
        table = Table(cells, colWidths=widths, repeatRows=1, splitByRow=1, splitInRow=1, hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), NAVY), ('VALIGN', (0,0), (-1,-1), 'TOP'),
                                   ('LINEBELOW', (0,0), (-1,-1), .35, STROKE), ('LEFTPADDING', (0,0), (-1,-1), 8),
                                   ('RIGHTPADDING', (0,0), (-1,-1), 8), ('TOPPADDING', (0,0), (-1,-1), 7), ('BOTTOMPADDING', (0,0), (-1,-1), 7)]))
        self.story.extend([table, Spacer(1, .3*cm)])

    def page(self):
        self.story.append(PageBreak())

    def cover(self, data):
        self.story.append(Spacer(1, 1.25*cm))
        self.add('SOC L2 | THREAT INVESTIGATION PLATFORM', 'Brand')
        self.add('Informe técnico de investigación' if self.kind == 'technical' else 'Informe ejecutivo de seguridad', 'Title')
        self.add('Proyecto académico | Comunidad DOJO y WoSEC Panamá', 'Muted')
        self.add('Evidencia verificable para orientar la investigación.' if self.kind == 'technical' else 'Alcance, señales preliminares y decisiones de investigación.')
        self.story.append(Spacer(1, .8*cm))
        preview = data['preview']
        self.table([['METADATO', 'ALCANCE DEL DOCUMENTO'],
                    ['Emisión (reloj del sistema, UTC)', now()],
                    ['Registros en alcance', data['summary']['total_events']],
                    ['Detecciones', 'Vista previa ejecutada; alertas preliminares' if preview else 'Detecciones no evaluadas'],
                    ['Validación del analista', 'Pendiente; no se certifican incidentes confirmados'],
                    ['Base temporal', 'Hipótesis explícita de relojes comparables' if preview and preview['options']['assume_comparable_clocks'] else 'Sin hipótesis de relojes comparables'],
                    ['Revisión del dataset', data['summary']['dataset_revision']]], [.32, .68])
        if data['synthetic']:
            self.add('LABORATORIO DEMO: los registros de este documento están marcados como sintéticos. No son evidencia de producción.', 'H2')
        self.add('Documento generado localmente. Su emisión no modifica eventos, casos, notas ni análisis almacenados.', 'Muted')
        self.page()

    def finish(self):
        kind = 'TÉCNICO' if self.kind == 'technical' else 'EJECUTIVO'
        def decorate(canvas, doc):
            canvas.saveState()
            canvas.setFillColor(NAVY); canvas.setFont('SOC-Bold', 8)
            canvas.drawString(1.8*cm, A4[1]-1.05*cm, 'SOC L2 | Threat Investigation Platform')
            canvas.drawRightString(A4[0]-1.8*cm, A4[1]-1.05*cm, kind)
            canvas.setStrokeColor(STROKE); canvas.line(1.8*cm, A4[1]-1.35*cm, A4[0]-1.8*cm, A4[1]-1.35*cm)
            canvas.line(1.8*cm, 1.25*cm, A4[0]-1.8*cm, 1.25*cm)
            canvas.setFont('SOC-Regular', 7); canvas.setFillColor(colors.HexColor('#53657A'))
            canvas.drawString(1.8*cm, .85*cm, 'Proyecto académico | Análisis preliminar | Uso local')
            canvas.drawRightString(A4[0]-1.8*cm, .85*cm, f'Página {doc.page}')
            canvas.restoreState()
        self.doc.build(self.story, onFirstPage=decorate, onLaterPages=decorate)
        content = self.output.getvalue()
        if not content.startswith(b'%PDF-') or not content.rstrip().endswith(b'%%EOF') or len(content) > MAX_PDF_BYTES:
            raise ValueError('El PDF no pudo validarse o supera 20 MB. No se guardó un archivo parcial.')
        return content


def _quantity(value, singular, plural):
    return f'{value} {singular if value == 1 else plural}'


def _scope(doc, data):
    summary = data['summary']
    doc.add('Alcance y origen del dataset', 'H1')
    records = _quantity(summary['total_events'], 'registro almacenado', 'registros almacenados')
    hosts = _quantity(summary['hosts']['unique_count'], 'identidad de host', 'identidades de host')
    users = _quantity(summary['users']['unique_count'], 'usuario', 'usuarios')
    ips = _quantity(summary['source_ips']['unique_count'], 'IP de origen válida', 'IP de origen válidas')
    doc.add(f'El documento comprende {records}, {hosts}, {users} y {ips}. Son identidades presentes; no equipos o cuentas declarados comprometidos.')
    filenames = list(dict.fromkeys(source['filename'] for source in data['sources']))
    for filename in filenames:
        doc.add('Fuente registrada: ' + filename, 'Muted')
    requests = summary['import_request_count']
    request_text = _quantity(requests, 'solicitud de importación', 'solicitudes de importación')
    intro = f"{'Se registra' if requests == 1 else 'Se registran'} {request_text}. "
    hashes = {source['sha256'] for source in data['sources']}
    if requests > 1 and len(data['sources']) == requests and len(hashes) == 1:
        origin = f'Las {requests} solicitudes corresponden a un mismo contenido de archivo. '
    else:
        contents = _quantity(summary['source_file_count'], 'contenido de archivo', 'contenidos de archivo')
        origin = f'Los registros únicos proceden de {contents}. '
    doc.add(intro + origin + 'Los duplicados no aumentan el total de registros únicos.', 'Muted')
    doc.table([['SEVERIDAD ORIGINAL', 'EVENTOS'], *[[item['value'] if item['value'] is not None else 'Sin valor indicado', item['count']] for item in summary['severity_original']]], [.75, .25])
    doc.add('Severity conserva el valor del archivo. No representa la prioridad calculada por una regla SOC ni una probabilidad de compromiso.', 'Muted')


def _analysis_overview(doc, data):
    preview = data['preview']
    if preview is None:
        doc.add('Detecciones no evaluadas', 'H2')
        doc.add('No se incluyó una vista previa ejecutada. Las métricas describen los registros de origen y no permiten concluir ausencia de amenazas, cero alertas o cero incidentes. La generación de este informe no ejecutó detecciones ni correlaciones.')
        return
    doc.add(f"Vista ejecutada: {preview['preview_id']} | Motor {preview['engine_version']}", 'Muted')
    count = preview['counts']['alerts']
    alerts = _quantity(count, 'alerta preliminar', 'alertas preliminares')
    doc.add(f"{'Se incluye' if count == 1 else 'Se incluyen'} {alerts} de la cobertura evaluada. La validación del analista está pendiente; no se certifican incidentes confirmados.")
    doc.table([['PRIORIDAD SOC', 'ALERTAS PRELIMINARES'], *[[PRIORITY_LABELS[level], preview['counts']['by_risk'][level]] for level in PRIORITY_LABELS]], [.65, .35])
    if not preview['alerts']:
        doc.add('No se observaron patrones que cumplan las reglas dentro de la cobertura evaluada. Revisar las reglas omitidas; este resultado no descarta amenazas.')
    if preview['options']['assumption']:
        doc.add(preview['options']['assumption'])
    omitted = [rule['name'] for rule in preview['coverage'] if rule['status'] == 'not_evaluated']
    if omitted:
        doc.add('Reglas no evaluadas por falta de evidencia suficiente: ' + '; '.join(omitted) + '. Consultar los motivos y la cobertura en el informe técnico.', 'Muted')
    doc.add('Las relaciones son vínculos de investigación. La ausencia de relaciones puede obedecer a falta de una base temporal válida, no a ausencia de actividad relacionada.', 'Muted')


def _recommendations(doc, data, *, technical=False):
    doc.add('Recomendaciones priorizadas', 'H1')
    if data['preview'] is None:
        doc.add('1. Ejecutar una vista previa SOC manual y revisar su cobertura antes de emitir conclusiones sobre amenazas.')
    elif data['preview']['alerts']:
        doc.add('1. Validar las alertas preliminares con el responsable del activo. Contrastar procesos, autenticaciones y autorizaciones antes de confirmar compromiso.')
    else:
        doc.add('1. Revisar exclusiones y cobertura: no interpretar una vista sin alertas como una garantía de seguridad.')
    if technical:
        doc.add('Para PowerShell, contrastar línea de comandos, proceso padre, firma, usuario y actividad de EDR. No ejecutar ni decodificar automáticamente comandos de los logs. Ante autenticaciones sospechosas, revisar identidad, MFA y sesiones; comprobar si los orígenes son servicios autorizados.')
    doc.add('2. Preservar la copia fuente independiente, su hash y las referencias de eventos. Completar evidencia cuando falten campos o el contenido esté redactado.')
    doc.add('3. Documentar zona horaria o justificar los relojes comparables antes de usar ventanas temporales. La ubicación del equipo no establece la zona de los logs.')
    doc.add('4. Aplicar contención o respuesta operativa únicamente después de la validación del analista y conforme al procedimiento autorizado. Este informe no ejecuta esas acciones.')


def _limitations(doc, data):
    doc.add('Limitaciones del análisis', 'H1')
    doc.add('Las fechas originales sin offset se presentan con Zona no indicada. No se utilizan las conversiones históricas sin justificación como instantes UTC verificados. Una hipótesis de relojes comparables no demuestra sincronización ni establece una zona horaria.')
    doc.add('Una alerta es una señal; la hipótesis debe contrastarse con evidencia. Incidentes confirmados: no disponible. El caso heredado y sus notas no se utilizaron como confirmaciones ni como hallazgos nuevos.')
    doc.add('Los hashes registrados identifican contenido de importación, sin certificar al emisor ni constituir una cadena de custodia inmutable. Cuando el binario o la hoja no se archivaron, se indica esa limitación. Los comandos redactados no permiten reconstruir su contenido omitido.')
    doc.add('No se consultaron servicios externos ni se ejecutaron comandos del dataset. El puntaje heurístico fijo expresa prioridad de revisión. Las reglas no cubren todas las técnicas y requieren los campos descritos.')
    doc.add('Presentación: controles o caracteres no disponibles en la tipografía incrustada se representan mediante secuencias Unicode visibles. Los valores originales permanecen intactos en SQLite.', 'Muted')


def _executive(doc, data):
    doc.add('Resumen ejecutivo', 'H1')
    doc.add('Este documento presenta el alcance de los registros disponibles y, cuando se selecciona una vista previa válida, señales preliminares para priorizar la investigación. No certifica que haya ocurrido un ataque.')
    _scope(doc, data)
    doc.add('Panorama de posibles riesgos', 'H1')
    _analysis_overview(doc, data)
    preview = data['preview']
    if preview and preview['alerts']:
        evidence = {event['id']: event for event in preview['evidence']}
        rows = [['ALERTA / REGLA', 'PRIORIDAD', 'EVIDENCIAS ORIGINALES']]
        for item in preview['alerts']:
            references = '\n'.join(original_value(evidence[eid], 'Log_ID') + f' | ID interno {eid}' for eid in item['evidence_ids'])
            rows.append([f"{item['title']}\n{item['id']}\nRegla {item['rule_id']}",
                         f"{PRIORITY_LABELS[item['severity']]} ({item['score']}/100)", references])
        doc.table(rows, [.44, .21, .35])
        doc.add('Los indicadores también pueden tener explicaciones benignas, como scripts administrativos, tareas autorizadas o errores de configuración. Se requiere validar el contexto antes de atribuir impacto.')
    _recommendations(doc, data)
    _limitations(doc, data)
    doc.add('Conclusión ejecutiva', 'H1')
    doc.add('La información de origen permite orientar la revisión y preservar referencias verificables. ' + ('Las alertas incluidas requieren investigación; no acreditan compromiso ni reemplazan la decisión del analista.' if preview else 'El alcance es descriptivo: Detecciones no evaluadas. Se necesita una ejecución y revisión explícitas antes de emitir conclusiones de seguridad.'))


def _technical(doc, data):
    _scope(doc, data)
    doc.add('Metodología', 'H1')
    doc.add('Snapshot de SQLite en mode=ro y query_only. Se conserva el mapeo de origen, IDs, archivo y fila. La vista previa, si se selecciona, se recupera de la memoria del servidor y debe coincidir con la revisión actual. No se aceptan hallazgos del navegador ni se recalculan reglas al exportar.')
    doc.add('Revisión del dataset: ' + data['summary']['dataset_revision'], 'Code')
    _analysis_overview(doc, data)
    doc.add('Reglas evaluadas y omitidas', 'H1')
    preview = data['preview']
    if preview is None:
        doc.table([['REGLA', 'CONDICIÓN', 'ESTADO'], *[[rule['id'] + ' | ' + rule['name'], rule['condition'], 'Detecciones no evaluadas'] for rule in data['rules']]], [.24, .52, .24])
    else:
        doc.table([['REGLA', 'EVALUADOS', 'SIN BASE TEMPORAL', 'SIN CONTEXTO / CAMPOS', 'ALERTAS'], *[[rule['id'], rule['evaluated_events'], rule['omitted_temporal_events'], rule['omitted_context_events'], rule['alerts']] for rule in preview['coverage']]], [.24, .16, .21, .23, .16])
        doc.add('Los conteos son por regla y pueden compartir eventos; no deben sumarse. Sin contexto/campos también incluye eventos no aplicables a esa regla. Una omisión no es un resultado negativo de seguridad.', 'Muted')
        for rule in preview['coverage']:
            doc.add(rule['id'] + ' | ' + rule['name'], 'H2')
            doc.add(rule['condition']); doc.add(rule['reason'], 'Muted')
    doc.page()
    doc.add('Hallazgos y evidencia vinculada', 'H1')
    if preview is None:
        doc.add('Detecciones no evaluadas. No se incluyen hallazgos ni comandos atribuidos a una detección.')
    elif not preview['alerts']:
        doc.add('Vista ejecutada sin alertas en la cobertura evaluada; consultar reglas omitidas y limitaciones.')
    else:
        evidence = {event['id']: event for event in preview['evidence']}
        for alert in preview['alerts']:
            doc.add(alert['id'] + ' | ' + alert['title'], 'H2')
            doc.add(f"Regla {alert['rule_id']} | Prioridad {PRIORITY_LABELS[alert['severity']]} | {alert['score']}/100 | Estado: pendiente de validación")
            doc.add(alert['explanation']); doc.add('Hipótesis: ' + alert['hypothesis'])
            doc.add('Justificación de prioridad: ' + alert['risk_reason'])
            doc.add('Eventos originales: ' + ', '.join(original_value(evidence[eid], 'Log_ID') for eid in alert['evidence_ids']))
            doc.add('Dependencia temporal: ' + ('esta alerta depende de la hipótesis de relojes comparables.' if alert['depends_on_clock_assumption'] else 'indicador individual sin ventana temporal.' if alert['rule_id'] == 'EXEC-001' else 'base temporal documentada en origen.'))
            doc.add('Posibles falsos positivos y límites: ' + alert['limitations'])
            if alert['related']:
                for link in alert['related']:
                    doc.add(f"Relación preliminar con {link['id']}: {', '.join(link['reasons'])}." + (' Depende de la hipótesis de relojes comparables.' if link['depends_on_clock_assumption'] else ''))
            else:
                doc.add('Sin relaciones incluidas: pueden haberse omitido por falta de una base temporal comparable.', 'Muted')
        doc.page(); doc.add('Anexo de evidencias originales', 'H1')
        for event in preview['evidence']:
            doc.add(original_value(event, 'Log_ID') + f" | ID interno {event['id']}", 'H2')
            doc.add('Hora original: ' + original_time(event))
            doc.add(f"Archivo: {event['filename']} | importación #{event['import_id']} | fila {event['row_number']} | hoja: {event.get('sheet_name') or 'No registrada'}", 'Muted')
            doc.add('SHA-256 registrado: ' + event['file_sha256'], 'Code')
            fields = ['Log_ID', 'Timestamp', 'Hostname', 'Event_ID', 'User', 'Source_IP', 'Destination', 'Log_Source', 'Result', 'Severity']
            doc.table([['CAMPO DE ORIGEN', 'VALOR CONSERVADO'], *[[header, original_value(event, header)] for header in fields]], [.3, .7])
            doc.add('Event_Description', 'H2'); doc.add(original_value(event, 'Event_Description'))
            doc.add('Process_CommandLine', 'H2'); doc.add(original_value(event, 'Process_CommandLine'), 'Code')
            extra = [(header, value) for header, value in event['raw'].items() if header not in SOURCE_COLUMNS.values()]
            if extra:
                doc.add('Encabezados adicionales o personalizados de origen', 'H2')
                doc.table([['ENCABEZADO ORIGINAL', 'VALOR CONSERVADO'], *[[header, str(value) if str(value).strip() else 'Vacío en el archivo'] for header, value in extra]], [.3, .7])
    doc.page(); doc.add('Trazabilidad de las importaciones', 'H1')
    for source in data['sources']:
        block_start = len(doc.story)
        doc.add(f"Importación #{source['id']} | {source['filename']}", 'H2')
        doc.add(source['sha256'], 'Code')
        doc.table([['METADATO', 'VALOR REGISTRADO'], ['Fecha de carga (no es hora de evento)', source['created_at']],
                   ['Filas nuevas / duplicadas / rechazadas', f"{source['accepted']} / {source['duplicates']} / {source['rejected']}"],
                   ['Binario archivado', 'Disponible en SQLite' if source['original_file_stored'] else 'No se conservó en esta importación'],
                   ['Hoja / zona declarada', f"{source['sheet_name'] or 'Hoja no registrada'} / {source['declared_timezone'] or 'Zona no indicada'}"]], [.4, .6])
        # These bounded metadata blocks fit on a page. Keep their identity and rows
        # together; long evidence tables elsewhere still split and repeat headers.
        doc.story[block_start:] = [KeepTogether(doc.story[block_start:])]
    _recommendations(doc, data, technical=True)
    _limitations(doc, data)


def make_report(data, kind='technical'):
    """Reuse the existing ReportLab entrypoint with an evidence-safe export model."""
    if kind not in ('technical', 'executive') or data.get('report_schema') != 1:
        raise ValueError('Tipo de informe o modelo de evidencia no válido.')
    document = _Document(kind)
    document.cover(data)
    (_technical if kind == 'technical' else _executive)(document, data)
    return document.finish()
