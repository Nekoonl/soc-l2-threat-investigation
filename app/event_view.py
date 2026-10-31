"""Read-only source presentation. Never change persisted normalization or fingerprints."""
from datetime import datetime
from zoneinfo import ZoneInfoNotFoundError

from .ingestion import FIELDS, key, parse_time

SOURCE_COLUMNS = {
    'log_id': 'Log_ID', 'timestamp': 'Timestamp', 'hostname': 'Hostname',
    'event_id': 'Event_ID', 'username': 'User', 'src_ip': 'Source_IP',
    'destination': 'Destination', 'log_source': 'Log_Source',
    'event_description': 'Event_Description', 'process_commandline': 'Process_CommandLine',
    'status': 'Result', 'source_severity': 'Severity',
}


def source_field(raw, field, mapping=None):
    """An explicitly empty source cell wins over a nonempty normalized fallback."""
    official = SOURCE_COLUMNS[field]
    for column in (official, (mapping or {}).get(field)):
        if column is not None and column in raw:
            return column, '' if raw[column] is None else str(raw[column])
    for alias in FIELDS[field]:
        match = next((column for column in raw if key(column) == key(alias)), None)
        if match is not None:
            return match, '' if raw[match] is None else str(raw[match])
    return None, None


def project_event(stored, *, mapping=None, declared_timezone=None, original_file_stored=False, import_created_at=None):
    """Recover preserved raw columns for API views without a data migration.

    The stored normalized timestamp stays available separately. UTC is asserted
    only for an embedded source offset or a recorded import-time declaration.
    """
    event = dict(stored)
    raw = stored.get('raw', {})
    fields, columns, values = {}, {}, {}
    normalized = {field: stored[field] for field in (*SOURCE_COLUMNS, 'dst_ip', 'message', 'timestamp_utc', 'timezone_status', 'source_timezone') if field in stored}
    legacy = False
    for field in SOURCE_COLUMNS:
        column, value = source_field(raw, field, mapping)
        fields[field] = 'missing' if column is None else 'present' if value.strip() else 'empty'
        if column is not None:
            columns[field] = column
            values[field] = value
            if field not in ('hostname', 'event_id', 'username', 'src_ip', 'status'):
                event[field] = value
            legacy = legacy or field not in stored

    source_time = event.get('timestamp') if 'timestamp' in columns else stored.get('timestamp_original')
    event['timestamp_original'] = source_time if source_time is not None else ''
    event['timestamp_utc'] = None
    event['source_timezone'] = declared_timezone
    if source_time:
        try:
            timestamp = parse_time(source_time, source_timezone=declared_timezone)
            known = datetime.fromisoformat(timestamp).tzinfo is not None
            event.update(timestamp=timestamp, timestamp_utc=timestamp if known else None,
                         timezone_status='known' if known else 'unknown')
            legacy = legacy or (not known and stored.get('timestamp') != timestamp and 'timezone_status' not in stored)
        except (ValueError, TypeError, OverflowError, ZoneInfoNotFoundError):
            event.update(timestamp=str(source_time), timezone_status='unverified')
    elif 'timestamp' in columns:
        event.update(timestamp='', timezone_status='unknown')
    else:
        # A +00:00 suffix on a stored value cannot prove the source's timezone.
        event['timezone_status'] = 'unverified'

    event['source_fields'] = fields
    event['source_columns'] = columns
    event['source_values'] = values
    event['stored_normalized'] = normalized
    event['provenance'] = {
        'legacy_normalization': legacy,
        'original_file_stored': bool(original_file_stored),
        'import_created_at': import_created_at,
        'declared_timezone': declared_timezone,
    }
    return event


def source_sql(field):
    """The same source-first view for search/options, using only trusted identifiers.

    json_each keeps a present empty cell distinct from a missing column. All
    request values are still bound by storage.query_events.
    """
    fallback = f"COALESCE(CAST(json_extract(e.data, '$.{field}') AS TEXT),'')"
    if field not in SOURCE_COLUMNS:
        return fallback
    official_path = '$.raw."' + SOURCE_COLUMNS[field] + '"'
    keys = list(dict.fromkeys(key(alias) for alias in FIELDS[field]))
    literals = ','.join("'" + alias.replace("'", "''") + "'" for alias in keys)
    priority = ' '.join(f"WHEN '{alias}' THEN {index}" for index, alias in enumerate(keys))
    return f"""CASE WHEN json_type(e.data, '{official_path}') IS NOT NULL
        THEN COALESCE(CAST(json_extract(e.data, '{official_path}') AS TEXT),'')
        ELSE COALESCE(
          (SELECT COALESCE(CAST(r.value AS TEXT),'') FROM json_each(e.data,'$.raw') r
           WHERE r.key=json_extract(i.mapping,'$.{field}') LIMIT 1),
          (SELECT COALESCE(CAST(r.value AS TEXT),'') FROM json_each(e.data,'$.raw') r
           WHERE source_key(r.key) IN ({literals})
           ORDER BY CASE source_key(r.key) {priority} ELSE 999 END,r.id LIMIT 1),
          {fallback}) END"""
