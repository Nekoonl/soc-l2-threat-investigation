import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DATABASE
from .detection import correlate, detect
from .event_view import project_event, source_sql
from .ingestion import key
from .time_policy import TimePolicy

WRITE_LOCK = threading.RLock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


@contextmanager
def connection():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE, timeout=20)
    db.row_factory = sqlite3.Row
    db.create_function('casefold', 1, lambda value: str(value).casefold() if value is not None else '', deterministic=True)
    db.create_function('source_key', 1, key, deterministic=True)
    db.execute('PRAGMA foreign_keys = ON')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def readonly_connection():
    """A preview cannot create a missing database, migrate it or write any table."""
    db = sqlite3.connect(DATABASE.resolve().as_uri() + '?mode=ro', uri=True, timeout=20)
    db.row_factory = sqlite3.Row
    db.create_function('casefold', 1, lambda value: str(value).casefold() if value is not None else '', deterministic=True)
    db.create_function('source_key', 1, key, deterministic=True)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        yield db
    finally:
        db.close()


def dataset_revision(db, *, include_synthetic=False):
    """Stream a stable revision inside the caller's read snapshot, without projection.

    Shared by summary and preview so cached alerts cannot describe another dataset.
    Includes source, normalization and import metadata; excludes mutable case notes.
    """
    revision = hashlib.sha256()
    rows = db.execute('''SELECT e.id,e.import_id,e.fingerprint,e.timestamp,e.data,
        i.filename,i.sha256,i.mapping,i.created_at,
        (SELECT d.source_timezone FROM import_details d WHERE d.import_id=i.id),
        EXISTS(SELECT 1 FROM import_files f WHERE f.sha256=i.sha256)
        FROM events e JOIN imports i ON i.id=e.import_id'''
        + ('' if include_synthetic else ' WHERE i.synthetic=0') + ' ORDER BY e.id')
    for row in rows:
        revision.update(json.dumps(tuple(row), ensure_ascii=False, separators=(',', ':')).encode())
        revision.update(b'\n')
    return revision.hexdigest()


def initialize():
    with connection() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL, accepted INTEGER NOT NULL, duplicates INTEGER NOT NULL,
            rejected INTEGER NOT NULL, synthetic INTEGER NOT NULL, mapping TEXT NOT NULL,
            errors TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, import_id INTEGER NOT NULL REFERENCES imports(id),
            fingerprint TEXT UNIQUE NOT NULL, timestamp TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
        CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
            notes TEXT NOT NULL DEFAULT '', analysis TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS import_files (
            sha256 TEXT PRIMARY KEY, content BLOB NOT NULL, size INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS import_details (
            import_id INTEGER PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
            source_timezone TEXT, sheet_name TEXT, analysis_ran INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS event_occurrences (
            id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
            row_number INTEGER NOT NULL, sheet_name TEXT, source_log_id TEXT NOT NULL,
            raw_data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS occurrences_event ON event_occurrences(event_id);
        ''')


def audit(db, action, details):
    db.execute('INSERT INTO audit(created_at, action, details) VALUES(?,?,?)', (now(), action, details))


def event_rows(db):
    rows = db.execute('SELECT e.*, i.filename, i.synthetic FROM events e JOIN imports i ON i.id=e.import_id ORDER BY e.timestamp, e.id').fetchall()
    return [{**json.loads(r['data']), 'id': r['id'], 'import_id': r['import_id'], 'filename': r['filename'], 'synthetic': bool(r['synthetic'])} for r in rows]


def incident_rows(db):
    return [{**json.loads(r['data']), 'status': r['status'], 'notes': r['notes'],
             'analysis': json.loads(r['analysis']) if r['analysis'] else None, 'updated_at': r['updated_at']}
            for r in db.execute('SELECT * FROM incidents')]


def recompute(db):
    events = soc_event_rows(db)
    if any(TimePolicy().point(event) is None for event in events):
        # Never replace stored cases with results from a temporally incomplete dataset.
        raise ValueError('Recálculo detenido: hay fechas sin base temporal absoluta documentada. '
                         'Los intervalos relativos requieren un ámbito explícito y se evalúan en memoria; '
                         'no se modificaron los incidentes existentes.')
    detected = detect(events)
    if len(detected) > 2000:
        raise ValueError('El laboratorio admite hasta 2.000 incidentes. Reduce el intervalo de los logs; la importación fue revertida.')
    previous = incident_rows(db)
    by_evidence = {}
    for item in previous:
        for eid in item['evidence_ids']:
            by_evidence.setdefault((item['rule_id'], eid), []).append(item)
    retained = set()
    saved = []
    for item in detected:
        candidates = {}
        for eid in item['evidence_ids']:
            for old in by_evidence.get((item['rule_id'], eid), []):
                if old['id'] not in retained:
                    candidates[old['id']] = old
        old = max(candidates.values(), key=lambda o: len(set(o['evidence_ids']) & set(item['evidence_ids'])), default=None)
        status, notes, analysis = 'new', '', None
        if old:
            item['id'] = old['id']
            retained.add(old['id'])
            status, notes = old['status'], old['notes']
            if old['evidence_ids'] == item['evidence_ids']:
                analysis = old['analysis']
            elif old['analysis']:
                audit(db, 'analysis_invalidated', item['id'] + ': se agregó evidencia; requiere nuevo análisis.')
        saved.append((item, status, notes, analysis))
    links = correlate([entry[0] for entry in saved], {e['id']: e for e in events})
    db.execute('DELETE FROM incidents')
    for item, status, notes, analysis in saved:
        item['related'] = links[item['id']]
        db.execute('INSERT INTO incidents(id,data,status,notes,analysis,updated_at) VALUES(?,?,?,?,?,?)',
                   (item['id'], json.dumps(item, ensure_ascii=False), status, notes,
                    json.dumps(analysis, ensure_ascii=False) if analysis else None, now()))


def save_import(filename, content, events, errors, mapping, synthetic=False, *, run_detection=True, source_timezone=None, sheet_name=None):
    with WRITE_LOCK, connection() as db:
        current = db.execute('SELECT COUNT(*) FROM events').fetchone()[0]
        if synthetic and current:
            raise ValueError('El escenario demo solo puede cargarse en una base vacía para evitar mezclar evidencia real y sintética.')
        if not synthetic and db.execute('SELECT COUNT(*) FROM imports WHERE synthetic=1').fetchone()[0]:
            raise ValueError('Reinicia el laboratorio demo antes de importar evidencia propia.')
        digest = hashlib.sha256(content).hexdigest()
        # Preserve exact source bytes once per content hash, even for rejected rows.
        db.execute('INSERT OR IGNORE INTO import_files(sha256,content,size) VALUES(?,?,?)', (digest, content, len(content)))
        cursor = db.execute('INSERT INTO imports(filename,sha256,created_at,accepted,duplicates,rejected,synthetic,mapping,errors) VALUES(?,?,?,?,?,?,?,?,?)',
                            (filename, digest, now(), 0, 0, len(errors), synthetic, json.dumps(mapping), json.dumps(errors, ensure_ascii=False)))
        import_id, accepted = cursor.lastrowid, 0
        sheet_name = sheet_name or next((event.get('sheet_name') for event in events if event.get('sheet_name')), None)
        db.execute('INSERT INTO import_details(import_id,source_timezone,sheet_name,analysis_ran) VALUES(?,?,?,?)',
                   (import_id, source_timezone, sheet_name, False))
        for event in events:
            cursor = db.execute('INSERT OR IGNORE INTO events(import_id,fingerprint,timestamp,data) VALUES(?,?,?,?)',
                                (import_id, event['fingerprint'], event['timestamp'], json.dumps(event, ensure_ascii=False)))
            accepted += cursor.rowcount
            event_id = db.execute('SELECT id FROM events WHERE fingerprint=?', (event['fingerprint'],)).fetchone()[0]
            # A duplicate is another occurrence, not a row whose provenance may be lost.
            db.execute('INSERT INTO event_occurrences(event_id,import_id,row_number,sheet_name,source_log_id,raw_data) VALUES(?,?,?,?,?,?)',
                       (event_id, import_id, event['row_number'], event.get('sheet_name'), event.get('log_id', ''), json.dumps(event['raw'], ensure_ascii=False)))
        if current + accepted > 100000:
            raise ValueError('El laboratorio admite 100.000 eventos acumulados. La importación fue revertida sin modificar los datos existentes.')
        duplicates = len(events) - accepted
        db.execute('UPDATE imports SET accepted=?,duplicates=? WHERE id=?', (accepted, duplicates, import_id))
        if accepted and run_detection:
            recompute(db)
            db.execute('UPDATE import_details SET analysis_ran=1 WHERE import_id=?', (import_id,))
        audit(db, 'import', f'{filename}: {accepted} nuevos, {duplicates} duplicados, {len(errors)} rechazados; SHA-256 {hashlib.sha256(content).hexdigest()}')
        return {'id': import_id, 'filename': filename, 'sha256': digest, 'accepted': accepted, 'duplicates': duplicates,
                'rejected': len(errors), 'total_rows': len(events) + len(errors), 'errors': errors[:100],
                'error_count': len(errors), 'mapping': mapping, 'source_timezone': source_timezone,
                'sheet_name': sheet_name, 'analysis_ran': bool(accepted and run_detection),
                'unknown_timezone': sum(event.get('timezone_status') == 'unknown' for event in events)}


EVENT_VIEW_SELECT = '''SELECT e.*,i.filename,i.sha256,i.synthetic,i.mapping,
    i.created_at AS import_created_at,
    (SELECT d.source_timezone FROM import_details d WHERE d.import_id=i.id) AS declared_timezone,
    EXISTS(SELECT 1 FROM import_files f WHERE f.sha256=i.sha256) AS original_file_stored'''


def _event_data(row):
    event = project_event(json.loads(row['data']), mapping=json.loads(row['mapping']),
                          declared_timezone=row['declared_timezone'], original_file_stored=row['original_file_stored'],
                          import_created_at=row['import_created_at'])
    return {**event, 'id': row['id'], 'import_id': row['import_id'], 'filename': row['filename'],
            'file_sha256': row['sha256'], 'synthetic': bool(row['synthetic'])}


def soc_event_rows(db, *, real_only=False):
    """Source-backed engine input, without repairing stored rows or running rules."""
    rows = db.execute(EVENT_VIEW_SELECT + ' FROM events e JOIN imports i ON i.id=e.import_id'
                      + (' WHERE i.synthetic=0' if real_only else '') + ' ORDER BY e.id').fetchall()
    return [_event_data(row) for row in rows]


def query_events(*, query='', page=1, page_size=50, filters=None, real_only=False):
    """Filter and page in SQLite. All user values remain bound parameters."""
    filters = filters or {}
    clauses, params = [], []
    if real_only:
        clauses.append('i.synthetic=0')
    if query:
        escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        fields = ('log_id', 'timestamp', 'src_ip', 'destination', 'dst_ip', 'hostname', 'username',
                  'event_id', 'event_type', 'status', 'log_source', 'source_severity', 'message', 'event_description', 'process_commandline')
        text = " || ' ' || ".join('(' + source_sql(field) + ')' for field in fields)
        clauses.append(f"casefold({text}) LIKE ? ESCAPE '\\'")
        params.append('%' + escaped.casefold() + '%')
    for field in ('log_source', 'hostname', 'status', 'source_severity'):
        if filters.get(field):
            clauses.append(f"casefold({source_sql(field)}) = ?")
            params.append(filters[field].casefold())
    if filters.get('import_id'):
        # Include repeated occurrences of an existing event in this import.
        clauses.append('(e.import_id=? OR EXISTS (SELECT 1 FROM event_occurrences o WHERE o.event_id=e.id AND o.import_id=?))')
        params.extend([filters['import_id'], filters['import_id']])
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    join = ' FROM events e JOIN imports i ON i.id=e.import_id'
    with connection() as db:
        db.execute('BEGIN')
        total = db.execute('SELECT COUNT(*)' + join + where, params).fetchone()[0]
        dataset_total = db.execute('SELECT COUNT(*)' + join + (' WHERE i.synthetic=0' if real_only else '')).fetchone()[0]
        pages = (total + page_size - 1) // page_size
        page = min(page, max(1, pages))
        rows = db.execute(EVENT_VIEW_SELECT + join + where + ' ORDER BY e.id DESC LIMIT ? OFFSET ?',
                          [*params, page_size, (page-1)*page_size]).fetchall()
    return {'events': [_event_data(row) for row in rows], 'total': total, 'dataset_total': dataset_total,
            'page': page, 'page_size': page_size, 'pages': pages}


def event_filter_options():
    with connection() as db:
        db.execute('BEGIN')
        options = {}
        for field in ('log_source', 'hostname', 'status', 'source_severity'):
            rows = db.execute(f"SELECT DISTINCT ({source_sql(field)}) AS value FROM events e JOIN imports i ON i.id=e.import_id WHERE i.synthetic=0 ORDER BY value").fetchall()
            options[field] = [row['value'] for row in rows if row['value'].strip()]
        options['imports'] = [dict(row) for row in db.execute('SELECT id,filename,created_at,accepted,duplicates,rejected FROM imports WHERE synthetic=0 ORDER BY id DESC')]
    return options


def get_event(event_id):
    with connection() as db:
        db.execute('BEGIN')
        row = db.execute(EVENT_VIEW_SELECT + ' FROM events e JOIN imports i ON i.id=e.import_id WHERE e.id=?', (event_id,)).fetchone()
        if row is None:
            return None
        event = _event_data(row)
        occurrences = db.execute('SELECT o.*,i.filename,i.sha256,i.created_at FROM event_occurrences o JOIN imports i ON i.id=o.import_id WHERE o.event_id=? ORDER BY o.id', (event_id,)).fetchall()
        event['occurrences'] = [{**dict(row), 'raw': json.loads(row['raw_data'])} for row in occurrences]
        for occurrence in event['occurrences']:
            del occurrence['raw_data']
    return event


def snapshot():
    with connection() as db:
        db.execute('BEGIN')
        events, incidents = event_rows(db), incident_rows(db)
        imports = [dict(r) for r in db.execute('SELECT id,filename,sha256,created_at,accepted,duplicates,rejected,synthetic FROM imports ORDER BY id DESC')]
        recent_audit = [dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 30')]
    incidents.sort(key=lambda i: (-i['score'], i['first_seen']))
    severity = {key: sum(i['severity'] == key for i in incidents) for key in ('critical', 'high', 'medium', 'low')}
    assets = {e['hostname'] or e['dst_ip'] for e in events if e['hostname'] or e['dst_ip']}
    return {'events': events, 'incidents': incidents, 'imports': imports, 'audit': recent_audit,
            'metrics': {'events': len(events), 'incidents': len(incidents), 'critical': severity['critical'],
                        'assets': len(assets), 'severity': severity, 'open': sum(i['status'] in ('new', 'investigating') for i in incidents)},
            'synthetic': bool(imports and all(i['synthetic'] for i in imports))}


def get_incident(incident_id):
    with connection() as db:
        row = db.execute('SELECT * FROM incidents WHERE id=?', (incident_id,)).fetchone()
        if row is None:
            return None
        item = {**json.loads(row['data']), 'status': row['status'], 'notes': row['notes'],
                'analysis': json.loads(row['analysis']) if row['analysis'] else None}
        evidence_ids = set(item['evidence_ids'])
        item['evidence'] = [e for e in event_rows(db) if e['id'] in evidence_ids]
        return item


def update_incident(incident_id, status, notes):
    if status not in ('new', 'investigating', 'resolved', 'false_positive'):
        raise ValueError('Estado no válido.')
    if not isinstance(notes, str) or len(notes) > 10000:
        raise ValueError('Las notas admiten como máximo 10.000 caracteres.')
    with WRITE_LOCK, connection() as db:
        cursor = db.execute('UPDATE incidents SET status=?, notes=?, updated_at=? WHERE id=?', (status, notes, now(), incident_id))
        if not cursor.rowcount:
            raise LookupError('Incidente no encontrado.')
        audit(db, 'triage', f'{incident_id}: {status}; notas actualizadas.')


def save_analysis(incident_id, analysis, expected_evidence):
    with WRITE_LOCK, connection() as db:
        row = db.execute('SELECT data FROM incidents WHERE id=?', (incident_id,)).fetchone()
        if row is None or json.loads(row['data'])['evidence_ids'] != expected_evidence:
            raise ValueError('La evidencia cambió durante el análisis. Vuelve a analizar el incidente.')
        db.execute('UPDATE incidents SET analysis=?, updated_at=? WHERE id=?', (json.dumps(analysis, ensure_ascii=False), now(), incident_id))
        audit(db, 'analysis', f"{incident_id}: {analysis['provider']}")


def reset_demo():
    with WRITE_LOCK, connection() as db:
        if db.execute('SELECT COUNT(*) FROM imports WHERE synthetic=0').fetchone()[0]:
            raise ValueError('Solo se puede reiniciar la base desde la interfaz cuando contiene exclusivamente datos demo.')
        db.execute('DELETE FROM incidents')
        db.execute('DELETE FROM events')
        db.execute('DELETE FROM imports')
        audit(db, 'reset_demo', 'Escenario sintético eliminado por el usuario.')
