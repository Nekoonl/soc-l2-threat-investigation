"""Temporal regressions use isolated fixtures, never the user's evidence database."""
import copy
import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from app import storage
from app.detection import correlate, detect, epoch, window_matches
from app.time_policy import RelativeClockScope, TimePolicy, read_source_time
from scripts.audit_data import audit_database, compare_source, digest
from tests.test_event_view import legacy_record
from tests.test_import_events import HEADERS, fixture_row


def source_events(seconds=(0, 75, 150, 225, 300)):
    events = []
    for index, elapsed in enumerate(seconds):
        original = (datetime(2026, 10, 29, 10) + timedelta(seconds=elapsed)).isoformat(sep=' ')
        events.append({**legacy_record(f'TEST-TIME-{index}', Timestamp=original), 'id': index})
    return events


def relative_policy(events):
    return TimePolicy(RelativeClockScope('test-clock', frozenset(e['id'] for e in events),
                                        'TEST ONLY: se supone un mismo reloj estable y sincronizado; zona desconocida.'))


class SourceTimeTests(unittest.TestCase):
    def test_legacy_raw_wins_without_changing_original_or_assigning_a_zone(self):
        event = source_events()[0]
        event['source_timezone'] = 'America/Panama'  # An old normalized field is not a documented declaration.
        before = copy.deepcopy(event)
        source = read_source_time(event)
        self.assertEqual(source.original, event['raw']['Timestamp'])
        self.assertEqual(source.normalized, '2026-10-29T10:00:00')
        self.assertIsNone(source.utc)
        self.assertEqual(source.status, 'unknown')
        self.assertIsNone(TimePolicy().point(event))
        with self.assertRaisesRegex(ValueError, 'base temporal'):
            epoch(event)
        self.assertEqual(event, before)

    def test_explicit_offsets_and_recorded_declarations_are_reproducible(self):
        for original in ('2026-10-29T10:00:00-05:00', '2026-10-29T17:00:00+02:00', '2026-10-29T15:00:00Z'):
            with self.subTest(original=original):
                event = {**legacy_record(Timestamp=original), 'id': 1}
                self.assertEqual(read_source_time(event).utc, '2026-10-29T15:00:00+00:00')
                self.assertEqual(TimePolicy().point(event).domain, ('absolute', 'UTC'))
        for declared, expected in [('UTC', '2026-10-29T10:00:00+00:00'), ('America/Panama', '2026-10-29T15:00:00+00:00')]:
            event = {**source_events()[0], 'provenance': {'declared_timezone': declared}}
            self.assertEqual(read_source_time(event).utc, expected)

    def test_empty_invalid_and_missing_source_never_fall_back_to_old_utc(self):
        for value in ('', ' ', 'not-a-date'):
            event = {**legacy_record(Timestamp=value), 'timestamp_original': '2026-10-29T15:00:00Z'}
            self.assertIsNone(TimePolicy().point(event))
            self.assertEqual(read_source_time(event).original, value)
        event = {'import_id': 1, 'timestamp': '2026-10-29T15:00:00+00:00'}
        self.assertIsNone(TimePolicy().point(event))
        self.assertEqual(read_source_time(event).status, 'unverified')

    def test_relative_coordinates_require_named_scope_ids_and_an_assumption(self):
        events = source_events()
        policy = relative_policy(events)
        self.assertEqual(policy.seconds(events[-1]) - policy.seconds(events[0]), 300)
        self.assertIsNone(policy.point({**events[0], 'id': 999}))
        self.assertEqual(policy.describe(events)['kind'], 'relative')
        self.assertFalse(policy.describe(events)['utc_verified'])
        self.assertIsNotNone(policy.describe(events)['assumption'])
        self.assertNotIn('+00:00', policy.timestamp(events[0]))
        for name, ids, assumption in [('', {1}, 'test'), ('test', set(), 'test'), ('test', {1}, '')]:
            with self.assertRaises(ValueError):
                RelativeClockScope(name, frozenset(ids), assumption)


class TemporalEngineTests(unittest.TestCase):
    def test_unknown_time_blocks_temporal_rules_but_keeps_individual_command_evidence(self):
        events = source_events()
        self.assertEqual(detect(events), [])
        command = {**events[0], 'event_id': '4104', 'message': 'TEST ONLY powershell.exe -enc DEMO'}
        command['raw'] = {**command['raw'], 'Event_ID': '4104', 'Process_CommandLine': command['message']}
        finding = detect([command])[0]
        self.assertEqual(finding['rule_id'], 'EXEC-001')
        self.assertEqual(finding['first_seen'], '2026-10-29T10:00:00')
        self.assertEqual(finding['time_basis']['kind'], 'unavailable')
        self.assertFalse(finding['time_basis']['utc_verified'])

    def test_relative_rolling_windows_use_original_time_and_keep_inclusive_boundaries(self):
        events = source_events()
        policy = relative_policy(events)
        self.assertEqual(len(list(window_matches(events, 300, 5, time_policy=policy))), 1)
        finding = detect(events, time_policy=policy)[0]
        self.assertEqual(finding['first_seen'], '2026-10-29T10:00:00')
        self.assertEqual(finding['last_seen'], '2026-10-29T10:05:00')
        self.assertEqual(finding['time_basis']['kind'], 'relative')
        outside = source_events((0, 75, 150, 225, 301))
        self.assertEqual(detect(outside, time_policy=relative_policy(outside)), [])
        self.assertEqual(list(window_matches(events, 300, 5)), [])

    def test_absolute_and_relative_domains_never_share_a_detection_window(self):
        events = source_events()
        for event in events[:2]:
            event['raw']['Timestamp'] = event['raw']['Timestamp'].replace(' ', 'T') + 'Z'
        self.assertEqual(detect(events, time_policy=relative_policy(events)), [])
        # Each domain alone has fewer than five events even when wall-clock values overlap.
        self.assertEqual(list(window_matches(events, 300, 5, time_policy=relative_policy(events))), [])

    def test_absolute_windows_normalize_source_offsets_not_historical_timestamps(self):
        events = source_events()
        for index, event in enumerate(events):
            local = datetime(2026, 10, 29, 10) + timedelta(seconds=index * 75)
            event['raw']['Timestamp'] = local.isoformat() + '-05:00'
            event['timestamp'] = '1999-01-01T00:00:00+00:00'
        finding = detect(events)[0]
        self.assertEqual(finding['first_seen'], '2026-10-29T15:00:00+00:00')
        self.assertEqual(finding['last_seen'], '2026-10-29T15:05:00+00:00')
        self.assertTrue(finding['time_basis']['utc_verified'])

    def test_success_after_failures_respects_relative_order_and_ten_minute_boundary(self):
        events = source_events((0, 10, 20, 30, 40))
        for elapsed, expected in [(600, True), (601, False), (-1, False)]:
            success = {**source_events((elapsed,))[0], 'id': 99, 'event_id': '4624', 'status': 'success'}
            success['raw'].update(Event_ID='4624', Result='success')
            all_events = events + [success]
            rules = {item['rule_id'] for item in detect(all_events, time_policy=relative_policy(all_events))}
            self.assertEqual('AUTH-002' in rules, expected)

    def test_correlation_uses_complete_source_evidence_not_stale_incident_bounds(self):
        events = source_events((0, 1800))
        incidents = [
            {'id': 'TEST-A', 'title': 'TEST', 'evidence_ids': [0], 'first_seen': '1999-01-01T00:00:00Z', 'last_seen': '1999-01-01T00:00:00Z'},
            {'id': 'TEST-B', 'title': 'TEST', 'evidence_ids': [1], 'first_seen': '2099-01-01T00:00:00Z', 'last_seen': '2099-01-01T00:00:00Z'},
        ]
        by_id = {event['id']: event for event in events}
        self.assertEqual(correlate(incidents, by_id), {'TEST-A': [], 'TEST-B': []})
        self.assertTrue(correlate(incidents, by_id, time_policy=relative_policy(events))['TEST-A'])
        events[1]['raw']['Timestamp'] = '2026-10-29T10:30:01'
        self.assertFalse(correlate(incidents, by_id, time_policy=relative_policy(events))['TEST-A'])
        del by_id[1]
        self.assertFalse(correlate(incidents, by_id, time_policy=relative_policy(events))['TEST-A'])

    def test_mixed_or_incomplete_temporal_evidence_cannot_be_correlated(self):
        events = source_events((0, 1))
        events[1]['raw']['Timestamp'] = '2026-10-29T10:00:01Z'
        incidents = [{'id': f'TEST-{index}', 'title': 'TEST', 'evidence_ids': [index]} for index in range(2)]
        self.assertEqual(correlate(incidents, {e['id']: e for e in events}, time_policy=relative_policy(events)), {'TEST-0': [], 'TEST-1': []})


class ReadOnlySourceValidationTests(unittest.TestCase):
    def test_persisting_a_recalculation_is_blocked_before_detection_or_case_replacement(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(storage, 'DATABASE', Path(directory) / 'TEST.db'):
            storage.initialize()
            event = source_events()[0]
            with storage.connection() as db:
                db.execute('INSERT INTO imports VALUES(1,?,?,?,?,?,?,?,?,?)', ('TEST.xlsx', 'a' * 64, '2026-10-29T16:00:00Z', 1, 0, 0, 0, '{}', '[]'))
                db.execute('INSERT INTO events VALUES(1,1,?,?,?)', (event['fingerprint'], event['timestamp'], json.dumps(event)))
                db.execute("INSERT INTO incidents(id,data,updated_at) VALUES('TEST-CASE','{}','2026-10-29T16:00:00Z')")
            before = audit_database(storage.DATABASE)['state']
            with storage.connection() as db, patch('app.storage.detect', side_effect=AssertionError('Must stop before detection')):
                with self.assertRaisesRegex(ValueError, 'Recálculo detenido'):
                    storage.recompute(db)
            self.assertEqual(before, audit_database(storage.DATABASE)['state'])

    def test_soc_reader_uses_original_time_without_writes_or_automatic_detection(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(storage, 'DATABASE', Path(directory) / 'TEST.db'):
            storage.initialize()
            event = source_events()[0]
            with storage.connection() as db:
                db.execute('INSERT INTO imports VALUES(1,?,?,?,?,?,?,?,?,?)', ('TEST.xlsx', 'a' * 64, '2026-10-29T16:00:00Z', 1, 0, 0, 0, '{}', '[]'))
                db.execute('INSERT INTO events VALUES(1,1,?,?,?)', (event['fingerprint'], event['timestamp'], json.dumps(event)))
            before = audit_database(storage.DATABASE)['state']
            with closing(sqlite3.connect(storage.DATABASE.as_uri() + '?mode=ro', uri=True)) as db:
                db.row_factory = sqlite3.Row
                db.execute('PRAGMA query_only=ON')
                with patch('app.storage.detect', side_effect=AssertionError('No automatic SOC')), patch('app.storage.correlate', side_effect=AssertionError('No automatic SOC')):
                    loaded = storage.soc_event_rows(db)
                self.assertEqual(loaded[0]['timestamp_original'], event['raw']['Timestamp'])
                self.assertEqual(loaded[0]['timestamp'], '2026-10-29T10:00:00')
                self.assertIsNone(loaded[0]['timestamp_utc'])
                self.assertIsNone(TimePolicy().point(loaded[0]))
            self.assertEqual(before, audit_database(storage.DATABASE)['state'])

    def test_xlsx_comparison_checks_hash_all_columns_blanks_sheet_and_physical_row(self):
        with tempfile.TemporaryDirectory() as directory:
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = 'TEST Evidence'
            sheet.append(HEADERS)
            sheet.append([None] * 12)
            values = fixture_row('TEST-0001', '2026-10-29 10:00:00', Destination='', Process_CommandLine='')
            sheet.append(values)
            output = io.BytesIO()
            workbook.save(output)
            path = Path(directory) / 'TEST.xlsx'
            path.write_bytes(output.getvalue())
            event = {**legacy_record(), 'id': 1, 'import_id': 1, 'row_number': 3,
                     'raw': dict(zip(HEADERS, values))}
            imports = [{'id': 1, 'sha256': digest(path.read_bytes())}]
            result = compare_source(path, imports, [event])
            self.assertTrue(result['verified_match'])
            self.assertEqual(result['field_match_counts'], dict.fromkeys(HEADERS, 1))
            self.assertEqual(result['source_sheets'], ['TEST Evidence'])
            self.assertEqual(result['traceability']['rows_equal'], 1)
            self.assertEqual(result['traceability']['sheets_not_recorded'], 1)
            self.assertEqual(result['source_empty_counts']['Destination'], 1)
            self.assertEqual(result['source_empty_counts']['Process_CommandLine'], 1)
            self.assertFalse(compare_source(path, [{'id': 1, 'sha256': '0' * 64}], [event])['verified_match'])
            for column in HEADERS:
                changed = copy.deepcopy(event)
                changed['raw'][column] = 'TEST MISMATCH'
                mismatch = compare_source(path, imports, [changed])
                self.assertFalse(mismatch['verified_match'], column)
                # Log_ID is the comparison key; a changed ID cannot select the stored row.
                if column != 'Log_ID':
                    self.assertEqual(mismatch['comparisons'][0]['different_columns'], [column])
            wrong_row = {**event, 'row_number': 2}
            self.assertFalse(compare_source(path, imports, [wrong_row])['verified_match'])
            wrong_sheet = {**event, 'sheet_name': 'TEST Wrong Sheet'}
            self.assertFalse(compare_source(path, imports, [wrong_sheet])['verified_match'])


if __name__ == '__main__':
    unittest.main()
