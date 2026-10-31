"""Export model from one read snapshot and an executed server preview, never client findings."""
import sqlite3

from . import storage
from .dashboard import summarize_snapshot
from .detection import RULES
from .preview_store import resolve

MAX_REPORT_ALERTS = 100
MAX_REPORT_EVIDENCE = 500


def build_report_data(*, preview_id=None, expected_revision=None, allow_demo=False):
    try:
        with storage.readonly_connection() as db:
            summary = summarize_snapshot(db)
            demo = bool(allow_demo and not summary['total_events'] and summary['excluded_synthetic_events'])
            if demo:
                summary = summarize_snapshot(db, include_synthetic=True)
            if not summary['total_events']:
                raise ValueError('No hay eventos importados suficientes para generar un informe. Importa evidencia antes de descargarlo.')
            if expected_revision is not None and expected_revision != summary['dataset_revision']:
                raise ValueError('El dataset cambió desde el alcance mostrado. Actualiza el resumen antes de generar el PDF.')
            preview = resolve(preview_id, summary['dataset_revision']) if preview_id else None
            if preview and preview['dataset']['event_count'] != summary['total_events']:
                raise ValueError('El alcance de la vista previa no coincide con el dataset actual.')
            if preview and (len(preview['alerts']) > MAX_REPORT_ALERTS or len(preview['evidence']) > MAX_REPORT_EVIDENCE):
                raise ValueError('La vista previa excede el límite PDF de 100 alertas o 500 evidencias. No se recortaron resultados; puedes generar el informe sin incluirla.')
            sources = [dict(row) for row in db.execute('''SELECT i.id,i.filename,i.sha256,i.created_at,
                i.accepted,i.duplicates,i.rejected,i.synthetic,
                (SELECT d.source_timezone FROM import_details d WHERE d.import_id=i.id) AS declared_timezone,
                (SELECT d.sheet_name FROM import_details d WHERE d.import_id=i.id) AS sheet_name,
                EXISTS(SELECT 1 FROM import_files f WHERE f.sha256=i.sha256) AS original_file_stored
                FROM imports i''' + ('' if demo else ' WHERE i.synthetic=0') + ' ORDER BY i.id')]
            # Evidence is retained on the server, bound to the exact input revision.
            # No browser-supplied alerts, raw values, timestamps or analyst states are accepted.
            return {'report_schema': 1, 'summary': summary, 'preview': preview,
                    'sources': sources, 'rules': RULES, 'synthetic': demo}
    except sqlite3.Error as exc:
        raise ValueError('No se pudo leer SQLite para generar el PDF. No se creó ni modificó ninguna base.') from exc
