"""Read-only aggregates of preserved source values; never executes SOC windows."""
import sqlite3
from collections import Counter

from . import storage
from .detection import auth_result
from .event_view import source_sql
from .preview import valid_ip

TOP_LIMIT = 10
FROM_REAL = ' FROM events e JOIN imports i ON i.id=e.import_id WHERE i.synthetic=0'


def distribution(db, field, *, from_sql=FROM_REAL):
    # Null groups only absent/blank values, without assigning a severity or source.
    expression = source_sql(field)
    return [dict(row) for row in db.execute(
        f"SELECT CASE WHEN trim(({expression}))='' THEN NULL ELSE ({expression}) END AS value, COUNT(*) AS count"
        + from_sql + ' GROUP BY value ORDER BY count DESC,value')]


def entities(db, field, *, ip=False, from_sql=FROM_REAL):
    # SQL aggregates before Python validation/canonicalization; no full events leave SQLite.
    grouped, missing = Counter(), 0
    for item in distribution(db, field, from_sql=from_sql):
        value = item['value'] or ''
        identity = valid_ip(value) if ip else value.strip().casefold()
        if identity in ('', '-', 'n/a', 'na', 'null', 'none', 'unknown'):
            missing += item['count']
        else:
            grouped[identity] += item['count']
    ordered = sorted(grouped.items(), key=lambda item: (-item[1], item[0]))
    return {'unique_count': len(grouped), 'missing_events': missing,
            'top': [{'value': value, 'count': count} for value, count in ordered[:TOP_LIMIT]],
            'other_events': sum(count for _, count in ordered[TOP_LIMIT:])}


def summarize_snapshot(db, *, include_synthetic=False):
    """Shared aggregate reader for Dashboard and PDF within the caller's transaction."""
    from_sql = FROM_REAL if not include_synthetic else ' FROM events e JOIN imports i ON i.id=e.import_id'
    revision = storage.dataset_revision(db, include_synthetic=include_synthetic)
    total = db.execute('SELECT COUNT(*)' + from_sql).fetchone()[0]
    severities = distribution(db, 'source_severity', from_sql=from_sql)
    sources = distribution(db, 'log_source', from_sql=from_sql)
    hosts = entities(db, 'hostname', from_sql=from_sql)
    users = entities(db, 'username', from_sql=from_sql)
    ips = entities(db, 'src_ip', ip=True, from_sql=from_sql)
    authentication = Counter(success=0, failure=0, unclassified=0)
    fields = ','.join(f"({source_sql(field)}) AS {field}" for field in ('event_id', 'event_type', 'status'))
    for row in db.execute('SELECT ' + fields + ',COUNT(*) AS count' + from_sql + ' GROUP BY 1,2,3'):
        context = {field: row[field].strip() for field in ('event_id', 'event_type', 'status')}
        context['event_id'] = context['event_id'].removesuffix('.0')
        recognized = context['event_id'] in ('4624', '4625') or bool(context['event_type'])
        authentication[(auth_result(context) if recognized else '') or 'unclassified'] += row['count']
    files = db.execute('SELECT COUNT(DISTINCT i.sha256)' + from_sql).fetchone()[0]
    requests = db.execute('SELECT COUNT(*) FROM imports' + ('' if include_synthetic else ' WHERE synthetic=0')).fetchone()[0]
    excluded = 0 if include_synthetic else db.execute('SELECT COUNT(*) FROM events e JOIN imports i ON i.id=e.import_id WHERE i.synthetic=1').fetchone()[0]
    stored_cases = db.execute('SELECT COUNT(*) FROM incidents').fetchone()[0]
    return {'schema_version': 1, 'read_only': True, 'dataset_revision': revision,
            'total_events': total, 'excluded_synthetic_events': excluded,
            'source_file_count': files, 'import_request_count': requests,
            'severity_original': severities, 'log_sources': sources,
            'hosts': hosts, 'users': users, 'source_ips': ips,
            'authentication': dict(authentication), 'stored_case_count': stored_cases,
            'confirmed_incidents': None}


def get_dashboard_summary():
    try:
        with storage.readonly_connection() as db:
            return summarize_snapshot(db)
    except sqlite3.Error as exc:
        raise ValueError('No se pudo leer el resumen de SQLite. Comprueba la base existente; no se creó ni modificó ninguna base.') from exc
