"""Regression coverage for read-only recovery, never a production data migration."""
import asyncio
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app import storage
from app.event_view import project_event
from scripts.audit_data import audit_database
from tests.test_import_events import HEADERS, csv_bytes, fixture_row
from tests.test_platform import asgi_request


def legacy_record(log_id='TEST-LEGACY', **overrides):
    raw = dict(zip(HEADERS, fixture_row(log_id, '2026-10-29 10:00:00')))
    raw.update(overrides)
    return {
        'timestamp': '2026-10-29T15:00:00+00:00', 'src_ip': '192.0.2.20', 'dst_ip': '',
        'username': 'test-user', 'hostname': 'test-host', 'event_id': '4625', 'event_type': '',
        'status': 'Failure', 'dst_port': 0, 'bytes_sent': 0, 'message': '',
        'raw': raw, 'row_number': 2, 'fingerprint': 'test-only-fingerprint',
    }


class SourceProjectionTests(unittest.TestCase):
    def test_preserves_all_12_original_values_without_changing_input_or_normalized_evidence(self):
        original = legacy_record()
        before = copy.deepcopy(original)
        view = project_event(original)
        self.assertEqual(len(view['source_values']), 12)
        for field, header in view['source_columns'].items():
            self.assertEqual(view['source_values'][field], original['raw'][header])
        self.assertEqual(view['log_id'], 'TEST-LEGACY')
        self.assertEqual(view['log_source'], 'Windows Security')
        self.assertEqual(view['source_severity'], 'High')
        self.assertEqual(view['timestamp'], '2026-10-29T10:00:00')
        self.assertIsNone(view['timestamp_utc'])
        self.assertEqual(view['timezone_status'], 'unknown')
        self.assertEqual(view['stored_normalized']['timestamp'], before['timestamp'])
        self.assertEqual(view['hostname'], 'test-host')
        self.assertEqual(view['source_values']['hostname'], 'TEST-HOST')
        self.assertTrue(view['provenance']['legacy_normalization'])
        self.assertFalse(view['provenance']['original_file_stored'])
        self.assertEqual(original, before)

    def test_distinguishes_an_empty_source_cell_from_a_missing_column_and_never_fills_it(self):
        original = legacy_record(Destination='', Process_CommandLine='')
        original['destination'] = 'WRONG NORMALIZED VALUE'
        del original['raw']['Severity']
        view = project_event(original)
        self.assertEqual(view['destination'], '')
        self.assertEqual(view['source_fields']['destination'], 'empty')
        self.assertEqual(view['source_fields']['process_commandline'], 'empty')
        self.assertEqual(view['source_fields']['source_severity'], 'missing')
        self.assertNotIn('source_severity', view['source_values'])

    def test_utc_requires_source_offset_or_recorded_declaration(self):
        for declared, expected in [('UTC', '2026-10-29T10:00:00+00:00'), ('America/Panama', '2026-10-29T15:00:00+00:00')]:
            with self.subTest(declared=declared):
                view = project_event(legacy_record(), declared_timezone=declared)
                self.assertEqual(view['timestamp_utc'], expected)
                self.assertEqual(view['provenance']['declared_timezone'], declared)
        view = project_event(legacy_record(Timestamp='2026-10-29T10:00:00-03:00'))
        self.assertEqual(view['timestamp_utc'], '2026-10-29T13:00:00+00:00')

    def test_a_stored_utc_suffix_without_original_time_does_not_prove_a_source_zone(self):
        original = legacy_record()
        del original['raw']['Timestamp']
        view = project_event(original)
        self.assertEqual(view['timestamp'], original['timestamp'])
        self.assertEqual(view['timezone_status'], 'unverified')
        self.assertIsNone(view['timestamp_utc'])


class LegacyReadApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'test-only.db'
        self.previous = storage.DATABASE
        storage.DATABASE = self.path
        storage.initialize()

    def tearDown(self):
        storage.DATABASE = self.previous
        self.temp.cleanup()

    def seed_legacy(self, record=None, mapping=None):
        record = record or legacy_record()
        content = csv_bytes([[record['raw'].get(header, '') for header in HEADERS]])
        digest = hashlib.sha256(content).hexdigest()
        mapping = mapping or {'timestamp': 'Timestamp', 'src_ip': 'Source_IP', 'username': 'User', 'hostname': 'Hostname', 'event_id': 'Event_ID', 'status': 'Result'}
        with storage.connection() as db:
            cursor = db.execute('INSERT INTO imports(filename,sha256,created_at,accepted,duplicates,rejected,synthetic,mapping,errors) VALUES(?,?,?,?,?,?,?,?,?)',
                                ('TEST-LEGACY.csv', digest, '2026-10-29T16:32:57+00:00', 1, 0, 0, 0, json.dumps(mapping), '[]'))
            db.execute('INSERT INTO events(import_id,fingerprint,timestamp,data) VALUES(?,?,?,?)',
                       (cursor.lastrowid, record['fingerprint'], record['timestamp'], json.dumps(record)))
        return content

    def request(self, path):
        status, body, _ = asyncio.run(asgi_request('GET', path))
        self.assertEqual(status, 200, body)
        return json.loads(body)

    def test_api_search_filters_pagination_detail_and_provenance_use_the_same_original_values(self):
        self.seed_legacy()
        before = audit_database(self.path)['state']
        page = self.request('/api/events?q=TEST-LEGACY&log_source=Windows%20Security&source_severity=High&hostname=TEST-HOST&page_size=10')
        self.assertEqual(page['total'], 1)
        event = page['events'][0]
        self.assertEqual(event['log_id'], 'TEST-LEGACY')
        self.assertEqual(event['timestamp_original'], '2026-10-29 10:00:00')
        self.assertEqual(event['timezone_status'], 'unknown')
        options = self.request('/api/events/options')
        self.assertEqual(options['log_source'], ['Windows Security'])
        self.assertEqual(options['hostname'], ['TEST-HOST'])
        self.assertEqual(options['source_severity'], ['High'])
        detail = self.request(f'/api/events/{event["id"]}')
        self.assertEqual(detail['raw']['Process_CommandLine'], 'TEST ONLY command')
        self.assertEqual(detail['event_description'], 'TEST ONLY description')
        self.assertEqual(detail['occurrences'], [])
        self.assertEqual(detail['import_id'], 1)
        self.assertEqual(detail['provenance']['import_created_at'], '2026-10-29T16:32:57+00:00')
        self.assertFalse(detail['provenance']['original_file_stored'])
        self.assertEqual(before, audit_database(self.path)['state'])

    def test_custom_mapping_aliases_and_empty_cells_match_between_sql_and_presentation(self):
        original = legacy_record()
        original['raw']['ORIGINAL_ID'] = original['raw'].pop('Log_ID')
        original['raw']['LOG_SOURCE'] = original['raw'].pop('Log_Source')
        original['raw']['Severity'] = ''
        original['source_severity'] = 'WRONG FALLBACK'
        self.seed_legacy(original, {'log_id': 'ORIGINAL_ID', 'timestamp': 'Timestamp'})
        event = self.request('/api/events?q=TEST-LEGACY')['events'][0]
        self.assertEqual(event['log_id'], 'TEST-LEGACY')
        self.assertEqual(event['log_source'], 'Windows Security')
        self.assertEqual(event['source_fields']['source_severity'], 'empty')
        self.assertEqual(event['source_severity'], '')
        options = self.request('/api/events/options')
        self.assertEqual(options['source_severity'], [])
        self.assertEqual(options['log_source'], ['Windows Security'])
        self.assertEqual(self.request('/api/events?source_severity=WRONG%20FALLBACK')['total'], 0)

    def test_readonly_audit_compares_every_cell_against_an_independent_original(self):
        content = self.seed_legacy()
        source = Path(self.temp.name) / 'TEST-ONLY.csv'
        source.write_bytes(content)
        before = audit_database(self.path)
        report = audit_database(self.path, source)
        comparison = report['source_comparison']
        self.assertTrue(comparison['verified_match'])
        self.assertEqual(comparison['all_12_fields_equal_rows'], 1)
        self.assertEqual(set(comparison['field_match_counts'].values()), {1})
        self.assertEqual(report['stored_files'], [])
        self.assertEqual(before['state'], report['state'])
        self.assertEqual(report['integrity_check'], ['ok'])

    def test_an_external_mismatch_is_reported_without_changing_database_values(self):
        self.seed_legacy()
        source = Path(self.temp.name) / 'TEST-CHANGED.csv'
        source.write_bytes(csv_bytes([fixture_row('TEST-LEGACY', '2026-10-29 10:00:00', Severity='Different source')]))
        before = audit_database(self.path)['state']
        report = audit_database(self.path, source)
        comparison = report['source_comparison']
        self.assertFalse(comparison['verified_match'])
        self.assertEqual(comparison['comparisons'][0]['different_columns'], ['Severity'])
        self.assertEqual(before, report['state'])


if __name__ == '__main__':
    unittest.main()
