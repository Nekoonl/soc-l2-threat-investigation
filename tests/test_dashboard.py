"""Read-only dashboard regressions. Fixtures are isolated from the user's SQLite."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import storage
from app.dashboard import get_dashboard_summary
from app.preview import run_preview
from scripts.audit_data import audit_database
from tests.test_import_events import fixture_row
from tests.test_preview import seed_rows
from tests.test_platform import asgi_request


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'TEST-DASHBOARD.db'
        self.patch = patch.object(storage, 'DATABASE', self.database)
        self.patch.start(); storage.initialize()

    def tearDown(self):
        self.patch.stop(); self.temp.cleanup()

    def state(self):
        return audit_database(self.database)['state']

    def test_source_severity_and_sources_are_aggregated_without_soc_risk(self):
        seed_rows([fixture_row('TEST-1', Severity='Informational', Log_Source='Security'),
                   fixture_row('TEST-2', Severity='Informational', Log_Source='Security'),
                   fixture_row('TEST-3', Severity='High', Log_Source='PowerShell'),
                   fixture_row('TEST-4', Severity='', Log_Source='')])
        result = get_dashboard_summary()
        self.assertEqual(result['total_events'], 4)
        self.assertEqual({item['value']: item['count'] for item in result['severity_original']}, {'Informational': 2, 'High': 1, None: 1})
        self.assertEqual({item['value']: item['count'] for item in result['log_sources']}, {'Security': 2, 'PowerShell': 1, None: 1})
        self.assertNotIn('alerts', result)
        self.assertNotIn('events', result)
        self.assertNotIn('timeline', result)

    def test_legacy_raw_mapping_wins_and_empty_cells_never_use_normalized_fallbacks(self):
        seed_rows([fixture_row('TEST-LEGACY')])
        with storage.connection() as db:
            row = db.execute('SELECT * FROM events').fetchone(); event = json.loads(row['data'])
            event.pop('source_severity'); event.pop('log_source')
            event['raw']['User'] = ''; event['raw']['Source_IP'] = 'not-an-ip'
            event['raw']['Hostname'] = 'N/A'
            db.execute('UPDATE events SET data=? WHERE id=?', (json.dumps(event), row['id']))
        result = get_dashboard_summary()
        self.assertEqual(result['severity_original'], [{'value': 'High', 'count': 1}])
        for field in ('users', 'source_ips', 'hosts'):
            self.assertEqual(result[field]['unique_count'], 0)
            self.assertEqual(result[field]['missing_events'], 1)

    def test_successful_processes_and_ambiguous_results_are_not_authentication(self):
        seed_rows([fixture_row('TEST-SUCCESS', Event_ID='4624', Result='Success'),
                   fixture_row('TEST-FAILURE', Event_ID='4625', Result='Failure'),
                   fixture_row('TEST-PROCESS', Event_ID='4688', Result='Success'),
                   fixture_row('TEST-CONNECTION', Event_ID='5156', Result='Success'),
                   fixture_row('TEST-AMBIGUOUS', Event_ID='', Result='Success')])
        self.assertEqual(get_dashboard_summary()['authentication'], {'success': 1, 'failure': 1, 'unclassified': 3})

    def test_entity_groups_fold_case_keep_distinct_names_and_report_top_remainder(self):
        rows = [fixture_row(f'TEST-{index}', Hostname=f'TEST-HOST-{index:02}', User='TEST-User') for index in range(12)]
        rows += [fixture_row('TEST-CASE', Hostname='test-host-00', User='test-user'), fixture_row('TEST-MISSING', Hostname='', User='N/A', Source_IP='N/A')]
        seed_rows(rows)
        result = get_dashboard_summary()
        self.assertEqual(result['hosts']['unique_count'], 12)
        self.assertEqual(len(result['hosts']['top']), 10)
        self.assertEqual(result['hosts']['other_events'], 2)
        self.assertEqual(result['hosts']['missing_events'], 1)
        self.assertEqual(result['users']['unique_count'], 1)
        self.assertEqual(result['users']['missing_events'], 1)
        for field in ('hosts', 'users', 'source_ips'):
            group = result[field]
            self.assertEqual(sum(item['count'] for item in group['top']) + group['other_events'] + group['missing_events'], 14)

    def test_empty_and_marked_synthetic_datasets_are_explicit(self):
        empty = get_dashboard_summary()
        self.assertEqual(empty['total_events'], 0)
        self.assertEqual(empty['severity_original'], [])
        self.assertEqual(empty['hosts']['top'], [])
        seed_rows([fixture_row('TEST-DEMO')], synthetic=True)
        result = get_dashboard_summary()
        self.assertEqual(result['total_events'], 0)
        self.assertEqual(result['excluded_synthetic_events'], 1)
        self.assertEqual(result['source_file_count'], 0)

    def test_summary_does_not_execute_rules_or_modify_any_table_or_confirm_legacy_cases(self):
        seed_rows([fixture_row('TEST-PS', Process_CommandLine='powershell.exe -enc TEST ONLY')])
        with storage.connection() as db:
            db.execute('INSERT INTO incidents(id,data,status,notes,analysis,updated_at) VALUES(?,?,?,?,?,?)',
                       ('TEST-CASE', '{"confirmed":true}', 'resolved', 'TEST preserve notes', '{"test":"analysis"}', '2026-10-30T10:00:00Z'))
        before = self.state()
        with patch('app.storage.connection', side_effect=AssertionError('No writable connection')), patch('app.preview.detect', side_effect=AssertionError('No SOC execution')), patch('app.storage.recompute', side_effect=AssertionError('No recalculation')):
            result = get_dashboard_summary()
        self.assertEqual(result['stored_case_count'], 1)
        self.assertIsNone(result['confirmed_incidents'])
        self.assertEqual(before, self.state())

    def test_revision_matches_executed_preview_and_changes_when_event_input_changes(self):
        seed_rows([fixture_row('TEST-FIRST')])
        first = get_dashboard_summary()
        self.assertEqual(first['dataset_revision'], run_preview()['dataset']['revision'])
        self.assertEqual(first, get_dashboard_summary())
        seed_rows([fixture_row('TEST-SECOND')])
        second = get_dashboard_summary()
        self.assertNotEqual(second['dataset_revision'], first['dataset_revision'])
        self.assertEqual(second['dataset_revision'], run_preview()['dataset']['revision'])

    def test_api_is_readonly_get_and_missing_database_is_not_created(self):
        before = self.state()
        status, body, _ = asyncio.run(asgi_request('GET', '/api/dashboard/summary'))
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['read_only'])
        status, _, _ = asyncio.run(asgi_request('POST', '/api/dashboard/summary'))
        self.assertEqual(status, 405)
        self.assertEqual(before, self.state())
        missing = Path(self.temp.name) / 'TEST-MISSING.db'
        with patch.object(storage, 'DATABASE', missing):
            with self.assertRaisesRegex(ValueError, 'No se pudo leer el resumen'):
                get_dashboard_summary()
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
