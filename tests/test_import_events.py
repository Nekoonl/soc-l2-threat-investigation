"""Stage 3A integration tests. All fixtures stay in temporary SQLite databases."""
import asyncio
import csv
import io
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from openpyxl import Workbook

from app import storage
from tests.test_platform import asgi_request, multipart

HEADERS = ['Log_ID', 'Timestamp', 'Hostname', 'Event_ID', 'User', 'Source_IP', 'Destination',
           'Log_Source', 'Event_Description', 'Process_CommandLine', 'Result', 'Severity']


def fixture_row(log_id='TEST-0001', timestamp='2026-10-29T10:00:00Z', **overrides):
    values = dict(zip(HEADERS, [log_id, timestamp, 'TEST-HOST', '4625', 'TEST-USER', '192.0.2.20',
                               'test-server.invalid', 'Windows Security', 'TEST ONLY description',
                               'TEST ONLY command', 'Failure', 'High']))
    values.update(overrides)
    return [values[field] for field in HEADERS]


def csv_bytes(rows):
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return output.getvalue().encode('utf-8-sig')


class ImportEventsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = storage.DATABASE
        storage.DATABASE = Path(self.temp.name) / 'isolated.db'
        storage.initialize()

    def tearDown(self):
        storage.DATABASE = self.previous
        self.temp.cleanup()

    def request(self, method, path, body=b'', headers=None):
        status, content, _ = asyncio.run(asgi_request(method, path, body, headers))
        return status, json.loads(content)

    def upload(self, content, filename='test-only.csv', timezone=None):
        body, headers = multipart(content, filename)
        if timezone:
            boundary = 'soc-l2-boundary-test'
            end = f'--{boundary}--\r\n'.encode()
            body = body[:-len(end)] + f'--{boundary}\r\nContent-Disposition: form-data; name="source_timezone"\r\n\r\n{timezone}\r\n'.encode() + end
        return self.request('POST', '/api/import', body, headers)

    def test_official_xlsx_preserves_identifiers_naive_time_original_bytes_and_fields(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = 'Registros'
        sheet.append(HEADERS)
        sheet.append([None] * len(HEADERS))
        sheet.append(fixture_row('0007', datetime(2026, 10, 29, 10, 23, 45)))
        stream = io.BytesIO()
        workbook.save(stream)
        content = stream.getvalue()
        status, result = self.upload(content, 'bootcamp-schema-test.xlsx')
        self.assertEqual(status, 201, result)
        self.assertEqual(result['accepted'], 1)
        self.assertEqual(len(result['mapping']), 12)
        self.assertEqual(result['unknown_timezone'], 1)
        self.assertFalse(result['analysis_ran'])
        status, page = self.request('GET', '/api/events?real_only=1')
        event = page['events'][0]
        self.assertEqual(event['log_id'], '0007')
        self.assertEqual(event['timestamp'], '2026-10-29T10:23:45')
        self.assertIsNone(event['timestamp_utc'])
        self.assertEqual(event['timezone_status'], 'unknown')
        self.assertEqual(event['destination'], 'test-server.invalid')
        self.assertEqual(event['dst_ip'], '')
        self.assertEqual(event['event_description'], 'TEST ONLY description')
        self.assertEqual(event['process_commandline'], 'TEST ONLY command')
        self.assertEqual(event['source_severity'], 'High')
        self.assertEqual(event['row_number'], 3)
        self.assertEqual(event['sheet_name'], 'Registros')
        self.assertEqual(event['raw']['Hostname'], 'TEST-HOST')
        with storage.connection() as db:
            original = db.execute('SELECT content FROM import_files WHERE sha256=?', (result['sha256'],)).fetchone()[0]
        self.assertEqual(original, content)

    def test_unknown_timezone_is_preserved_unless_explicitly_declared(self):
        content = csv_bytes([fixture_row(timestamp='2026-10-29T10:00:00')])
        self.assertEqual(self.upload(content)[0], 201)
        self.assertEqual(self.upload(content, timezone='America/Panama')[0], 201)
        _, page = self.request('GET', '/api/events')
        self.assertEqual(page['dataset_total'], 2)
        self.assertEqual(page['events'][0]['timestamp_utc'], '2026-10-29T15:00:00+00:00')
        self.assertEqual(page['events'][1]['timestamp'], '2026-10-29T10:00:00')
        self.assertEqual(self.upload(content, timezone='Unknown/Zone')[0], 422)

    def test_embedded_offset_and_fractional_seconds_survive_normalization(self):
        _, result = self.upload(csv_bytes([fixture_row(timestamp='2026-10-29T10:00:00.123456+02:00')]))
        _, page = self.request('GET', '/api/events')
        event = page['events'][0]
        self.assertEqual(event['timestamp_utc'], '2026-10-29T08:00:00.123456+00:00')
        self.assertEqual(event['timestamp_original'], '2026-10-29T10:00:00.123456+02:00')
        self.assertEqual(result['unknown_timezone'], 0)

    def test_distinct_source_ids_are_retained_and_duplicates_keep_all_occurrences(self):
        content = csv_bytes([fixture_row('TEST-01'), fixture_row('TEST-02')])
        _, first = self.upload(content, 'first-test.csv')
        self.assertEqual(first['accepted'], 2)
        _, second = self.upload(content, 'second-test.csv')
        self.assertEqual((second['accepted'], second['duplicates']), (0, 2))
        _, page = self.request('GET', f'/api/events?import_id={second["id"]}')
        self.assertEqual(page['total'], 2)
        _, detail = self.request('GET', f'/api/events/{page["events"][0]["id"]}')
        self.assertEqual([o['filename'] for o in detail['occurrences']], ['first-test.csv', 'second-test.csv'])
        with storage.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM import_files').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM event_occurrences').fetchone()[0], 4)

    def test_search_filters_options_and_pagination_are_applied_to_sqlite(self):
        rows = [fixture_row(f'TEST-{index:02}', Severity='High' if index < 12 else 'Low') for index in range(23)]
        status, result = self.upload(csv_bytes(rows))
        self.assertEqual(status, 201, result)
        _, page = self.request('GET', '/api/events?page=2&page_size=10&real_only=1')
        self.assertEqual((page['total'], len(page['events']), page['page'], page['pages']), (23, 10, 2, 3))
        _, filtered = self.request('GET', '/api/events?source_severity=Low&hostname=test-host&status=Failure&log_source=Windows%20Security')
        self.assertEqual(filtered['total'], 11)
        _, found = self.request('GET', '/api/events?q=TEST-04')
        self.assertEqual(found['total'], 1)
        _, options = self.request('GET', '/api/events/options')
        self.assertEqual(options['source_severity'], ['High', 'Low'])
        self.assertEqual(options['imports'][0]['accepted'], 23)
        self.assertEqual(self.request('GET', '/api/events?page_size=999')[0], 422)

    def test_literal_search_and_injection_strings_are_not_sql(self):
        self.upload(csv_bytes([fixture_row()]))
        for query in ('%25', '_', '%27%20OR%201%3D1--'):
            _, result = self.request('GET', f'/api/events?q={query}')
            self.assertEqual(result['total'], 0)

    def test_unicode_search_and_long_source_filename_are_preserved(self):
        filename = 'TEST-' + 'a' * 190 + '.csv'
        status, result = self.upload(csv_bytes([fixture_row(Event_Description='Conexión de revisión TEST ONLY')]), filename)
        self.assertEqual(status, 201, result)
        self.assertEqual(result['filename'], filename)
        _, page = self.request('GET', '/api/events?q=' + quote('CONEXIÓN'))
        self.assertEqual(page['total'], 1)
        self.assertEqual(page['events'][0]['filename'], filename)

    def test_partial_and_completely_rejected_imports_keep_original_and_existing_events(self):
        content = csv_bytes([fixture_row('TEST-OK'), fixture_row('TEST-BAD', 'not-a-date')])
        status, result = self.upload(content)
        self.assertEqual(status, 201)
        self.assertEqual((result['accepted'], result['rejected'], result['total_rows']), (1, 1, 2))
        self.assertEqual(result['errors'][0]['log_id'], 'TEST-BAD')
        status, invalid = self.upload(csv_bytes([fixture_row('TEST-BAD', 'not-a-date')]))
        self.assertEqual(status, 422)
        self.assertEqual((invalid['accepted'], invalid['rejected']), (0, 1))
        self.assertIn('id', invalid)
        _, page = self.request('GET', '/api/events')
        self.assertEqual(page['total'], 1)
        with storage.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM import_files').fetchone()[0], 2)

    def test_upload_does_not_run_or_modify_soc_rules(self):
        rows = [fixture_row(f'TEST-{index}', f'2026-10-29T10:00:0{index}Z') for index in range(6)]
        with patch('app.storage.recompute', side_effect=AssertionError('SOC engine must not run')):
            status, result = self.upload(csv_bytes(rows))
        self.assertEqual(status, 201, result)
        self.assertFalse(result['analysis_ran'])
        with storage.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM incidents').fetchone()[0], 0)

    def test_security_rejects_formulas_bad_types_and_foreign_origins(self):
        workbook = Workbook()
        workbook.active.append(HEADERS)
        workbook.active.append(fixture_row(timestamp='=NOW()'))
        stream = io.BytesIO()
        workbook.save(stream)
        self.assertEqual(self.upload(stream.getvalue(), 'formula.xlsx')[0], 422)
        self.assertEqual(self.upload(b'bad', 'not-excel.xlsx')[0], 422)
        self.assertEqual(self.upload(b'bad', 'bad.exe')[0], 422)
        body, headers = multipart(csv_bytes([fixture_row()]))
        status, _ = self.request('POST', '/api/import', body, [*headers, (b'origin', b'https://external.invalid')])
        self.assertEqual(status, 403)
        self.assertEqual(self.request('GET', '/api/events/999')[0], 404)

    def test_known_missing_ip_markers_are_preserved_in_raw(self):
        status, result = self.upload(csv_bytes([fixture_row(Source_IP='N/A')]))
        self.assertEqual(status, 201, result)
        _, page = self.request('GET', '/api/events')
        self.assertEqual(page['events'][0]['src_ip'], '')
        self.assertEqual(page['events'][0]['raw']['Source_IP'], 'N/A')

    def test_schema_initialization_is_additive_and_idempotent(self):
        self.upload(csv_bytes([fixture_row()]))
        _, before = self.request('GET', '/api/events')
        storage.initialize()
        _, after = self.request('GET', '/api/events')
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
