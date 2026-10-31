"""Audit source provenance without initializing the application or writing SQLite.

Run with the project's Python and -B. An optional original file is read and
compared; it is never imported. The JSON report contains counts/identifiers and
hashes, not copies of command lines or IP addresses.
"""
import argparse
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.ingestion import read_table  # noqa: E402; bounded, read-only file parsing

OFFICIAL_COLUMNS = ['Log_ID', 'Timestamp', 'Hostname', 'Event_ID', 'User', 'Source_IP', 'Destination',
                    'Log_Source', 'Event_Description', 'Process_CommandLine', 'Result', 'Severity']
CANONICAL = dict(zip(OFFICIAL_COLUMNS, ['log_id', 'timestamp', 'hostname', 'event_id', 'username', 'src_ip',
                                     'destination', 'log_source', 'event_description', 'process_commandline', 'status', 'source_severity']))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def logical_state(db, tables):
    state = {}
    for table in sorted(tables):
        name = '"' + table.replace('"', '""') + '"'
        rows = [tuple(row) for row in db.execute('SELECT * FROM ' + name + ' ORDER BY 1')]
        content = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), default=lambda value: digest(value)).encode()
        state[table] = {'count': len(rows), 'logical_sha256': digest(content)}
    return state


def compare_source(path, imports, events):
    content = path.read_bytes()
    file_hash = digest(content)
    headers, rows = read_table(path.name, content)
    report = {'path': str(path.resolve()), 'sha256': file_hash,
              'matching_import_ids': [item['id'] for item in imports if item['sha256'] == file_hash],
              'source_rows': len(rows), 'columns': headers, 'missing_official_columns': [c for c in OFFICIAL_COLUMNS if c not in headers]}
    if report['missing_official_columns']:
        report['status'] = 'incompatible_source_columns'
        return report
    stored = {}
    for event in events:
        stored.setdefault(event['raw'].get('Log_ID', ''), []).append(event)
    seen, empty_cells, traceability = Counter(), Counter(), Counter()
    normalized = {column: Counter() for column in OFFICIAL_COLUMNS}
    imports_by_id = {item['id']: item for item in imports}
    comparisons, equal_rows = [], 0
    field_matches = Counter()
    for row in rows:
        if len(row) != len(headers):
            comparisons.append({'source_row': row.source_row, 'status': 'invalid_source_column_count'})
            continue
        values = {header: '' if value is None else str(value) for header, value in zip(headers, row)}
        log_id = values['Log_ID']
        seen[log_id] += 1
        candidates = stored.get(log_id, [])
        if len(candidates) != 1 or not log_id:
            comparisons.append({'source_row': row.source_row, 'log_id': log_id, 'status': 'missing_or_ambiguous_stored_id'})
            continue
        event = candidates[0]
        differences = [column for column in OFFICIAL_COLUMNS if event['raw'].get(column) != values[column]]
        for column in OFFICIAL_COLUMNS:
            field_matches[column] += int(column not in differences)
            empty_cells[column] += int(not values[column].strip())
            canonical = CANONICAL[column]
            state = 'absent' if canonical not in event else 'equal' if str(event[canonical]) == values[column] else 'different'
            normalized[column][state] += 1
        source_sheet = getattr(row, 'sheet_name', None)
        stored_sheet = event.get('sheet_name')
        sheet_status = 'not_applicable' if source_sheet is None else 'not_recorded' if not stored_sheet else 'equal' if source_sheet == stored_sheet else 'different'
        row_matches = event.get('row_number') == row.source_row
        import_matches = imports_by_id.get(event['import_id'], {}).get('sha256') == file_hash
        traceability['rows_equal' if row_matches else 'rows_different'] += 1
        traceability['sheets_' + sheet_status] += 1
        traceability['import_hash_equal' if import_matches else 'import_hash_different'] += 1
        equal_rows += int(not differences)
        comparisons.append({'source_row': row.source_row, 'source_sheet': source_sheet,
                            'stored_row': event.get('row_number'), 'stored_sheet': stored_sheet,
                            'row_matches': row_matches, 'sheet_status': sheet_status,
                            'import_id': event['import_id'], 'import_hash_matches': import_matches,
                            'event_id': event['id'], 'log_id': log_id,
                            'status': 'equal_all_12_fields' if not differences else 'different', 'different_columns': differences})
    report.update(status='compared', all_12_fields_equal_rows=equal_rows,
                  field_match_counts=dict(field_matches), comparisons=comparisons,
                  source_empty_counts=dict(empty_cells), source_sheets=sorted({row.sheet_name for row in rows if row.sheet_name}),
                  traceability=dict(traceability), normalized_comparison={c: dict(counts) for c, counts in normalized.items()},
                  duplicate_source_ids=[key for key, count in seen.items() if count > 1],
                  stored_ids_not_in_source=sorted(set(stored) - set(seen)))
    report['verified_match'] = bool(report['matching_import_ids'] and equal_rows == len(rows) == len(events)
                                    and not report['duplicate_source_ids'] and not report['stored_ids_not_in_source']
                                    and not traceability['rows_different'] and not traceability['sheets_different']
                                    and not traceability['import_hash_different'])
    return report


def audit_database(database, source=None):
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        imports = [dict(row) for row in db.execute('SELECT * FROM imports ORDER BY id')]
        for item in imports:
            item['mapping'] = json.loads(item['mapping'])
            item['errors'] = json.loads(item['errors'])
        events = [{**json.loads(row['data']), 'id': row['id'], 'import_id': row['import_id']} for row in db.execute('SELECT * FROM events ORDER BY id')]
        fields = {column: Counter() for column in OFFICIAL_COLUMNS}
        shifts, source_counts, severity_counts = Counter(), Counter(), Counter()
        ids, rows_report = [], []
        for event in events:
            raw = event.get('raw', {})
            ids.append(raw.get('Log_ID', ''))
            source_counts[raw.get('Log_Source', '')] += 1
            severity_counts[raw.get('Severity', '')] += 1
            states = {}
            for column, canonical in CANONICAL.items():
                state = 'missing' if column not in raw else 'empty' if not str(raw[column]).strip() else 'present'
                states[column] = state
                fields[column]['raw_' + state] += 1
                fields[column]['normalized_missing'] += int(canonical not in event)
                fields[column]['normalized_empty'] += int(event.get(canonical) in ('', None))
            try:
                original_time = datetime.fromisoformat(raw.get('Timestamp', '').replace('Z', '+00:00'))
                stored_time = datetime.fromisoformat(event['timestamp'])
                if original_time.tzinfo is None:
                    fields['Timestamp']['source_without_zone'] += 1
                    shifts[str(int((stored_time.replace(tzinfo=None) - original_time).total_seconds()))] += 1
            except (ValueError, TypeError):
                fields['Timestamp']['not_parseable_for_comparison'] += 1
            raw_hash = digest(json.dumps(raw, ensure_ascii=False, sort_keys=True).encode())
            rows_report.append({'event_id': event['id'], 'import_id': event['import_id'], 'log_id': raw.get('Log_ID'),
                                'registered_row': event.get('row_number'), 'raw_sha256': raw_hash,
                                'source_field_status': states})
        stored_files = []
        if 'import_files' in tables:
            for file in db.execute('SELECT * FROM import_files'):
                stored_files.append({'recorded_sha256': file['sha256'], 'actual_sha256': digest(file['content']),
                                     'size': file['size'], 'hash_matches': digest(file['content']) == file['sha256']})
        return {
            'audited_at_utc': datetime.now(timezone.utc).isoformat(), 'database': str(Path(database).resolve()),
            'read_only': True, 'integrity_check': [row[0] for row in db.execute('PRAGMA integrity_check')],
            'foreign_key_violations': [tuple(row) for row in db.execute('PRAGMA foreign_key_check')],
            'state': logical_state(db, tables), 'imports': imports,
            'audit_log': [dict(row) for row in db.execute('SELECT * FROM audit ORDER BY id')],
            'import_details': [dict(row) for row in db.execute('SELECT * FROM import_details')] if 'import_details' in tables else [],
            'stored_files': stored_files, 'events_checked': len(events), 'unique_nonempty_log_ids': len({value for value in ids if value}),
            'raw_field_counts': {column: dict(counts) for column, counts in fields.items()},
            'timestamp_wall_clock_delta_seconds': dict(shifts), 'raw_log_sources': dict(source_counts),
            'raw_severities': dict(severity_counts), 'rows': rows_report,
            'source_comparison': compare_source(Path(source), imports, events) if source else {'status': 'source_not_supplied', 'verified_match': False},
        }
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'data' / 'soc.db')
    parser.add_argument('--source', type=Path, help='Read an original CSV/XLSX and compare all source cells; never import it.')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = audit_database(args.database, args.source)
    content = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding='utf-8')
        print(json.dumps({'report': str(args.output), 'events_checked': report['events_checked'], 'integrity_check': report['integrity_check'],
                          'source_comparison': report['source_comparison']['status'], 'state': report['state']}))
    else:
        print(content)


if __name__ == '__main__':
    main()
