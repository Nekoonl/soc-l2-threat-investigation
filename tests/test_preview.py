"""Preview integration and safety. All writes below are to temporary test databases."""
import asyncio
import csv
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from app import storage
from app.ingestion import normalize
from app.preview import adapt_event, run_preview
from scripts.audit_data import audit_database
from tests.test_import_events import HEADERS, fixture_row
from tests.test_platform import asgi_request


def test_rows(*, spraying=False, known_zone=False):
    rows = []
    for index in range(5):
        stamp = (datetime(2026, 10, 29, 10) + timedelta(seconds=index * 30)).isoformat() + ('Z' if known_zone else '')
        rows.append(fixture_row(f'TEST-AUTH-{index}', stamp, User=f'test-user-{index}' if spraying else 'test-user'))
    return rows


def seed_rows(rows, extra_headers=(), synthetic=False):
    headers = HEADERS + list(extra_headers)
    stream = io.StringIO(newline='')
    writer = csv.writer(stream); writer.writerow(headers); writer.writerows(rows)
    events, errors, mapping = normalize(headers, rows, source_timezone=None)
    if errors:
        raise AssertionError(errors)
    storage.save_import('TEST-PREVIEW.csv', stream.getvalue().encode(), events, errors, mapping,
                        synthetic=synthetic, run_detection=False, source_timezone=None)


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'TEST.db'
        self.patch = patch.object(storage, 'DATABASE', self.database)
        self.patch.start()
        storage.initialize()
        with storage.connection() as db:
            db.execute('INSERT INTO incidents(id,data,status,notes,analysis,updated_at) VALUES(?,?,?,?,?,?)',
                       ('TEST-SAVED', '{"fixture":true}', 'investigating', 'TEST: preserve notes', '{"fixture":"preserve analysis"}', '2026-10-29T10:00:00Z'))

    def tearDown(self):
        self.patch.stop(); self.temp.cleanup()

    def state(self):
        return audit_database(self.database)['state']

    def request(self, body=None, *, method='POST', headers=None):
        payload = json.dumps(body or {}).encode()
        status, content, _ = asyncio.run(asgi_request(method, '/api/detections/preview', payload,
                                        headers or [(b'content-type', b'application/json')]))
        return status, json.loads(content)

    def test_powershell_uses_original_command_and_explains_risk_without_time_assumption(self):
        seed_rows([fixture_row('TEST-PS', '2026-10-29T10:00:00', Event_ID='4688', Process_CommandLine='TEST ONLY powershell.exe -EncodedCommand <redacted>', Severity='Informational'),
                   fixture_row('TEST-BENIGN', '2026-10-29T10:01:00', Event_ID='4688', Process_CommandLine='powershell.exe -File TEST-approved.ps1')])
        # Emulate the legacy normalization gap; source evidence remains intact.
        with storage.connection() as db:
            row = db.execute('SELECT * FROM events ORDER BY id LIMIT 1').fetchone()
            data = json.loads(row['data']); data['message'] = ''; data['timestamp'] = '1999-01-01T00:00:00+00:00'
            db.execute('UPDATE events SET data=? WHERE id=?', (json.dumps(data), row['id']))
        before = self.state()
        result = run_preview()
        self.assertEqual(result['counts']['alerts'], 1)
        alert = result['alerts'][0]
        self.assertEqual((alert['rule_id'], alert['severity'], alert['score']), ('EXEC-001', 'high', 82))
        self.assertIn('heurística fija', alert['risk_reason'])
        self.assertIn('No es probabilidad', alert['risk_reason'])
        self.assertFalse(alert['depends_on_clock_assumption'])
        self.assertEqual(alert['analyst_status'], 'pending_review')
        self.assertEqual(alert['time_basis']['kind'], 'unavailable')
        self.assertEqual(result['evidence'][0]['raw']['Log_ID'], 'TEST-PS')
        self.assertEqual(result['evidence'][0]['raw']['Severity'], 'Informational')
        self.assertNotIn('1999', alert['first_seen'])
        self.assertEqual(before, self.state())

    def test_brute_force_success_and_correlation_require_explicit_relative_opt_in(self):
        rows = test_rows()
        rows.append(fixture_row('TEST-SUCCESS', '2026-10-29T10:03:00', User='test-user', Event_ID='4624', Result='Success'))
        seed_rows(rows)
        before = self.state()
        strict = run_preview()
        self.assertEqual(strict['counts']['alerts'], 0)
        self.assertEqual(strict['counts']['correlations'], 0)
        coverage = {rule['id']: rule for rule in strict['coverage']}
        self.assertEqual(coverage['AUTH-001']['omitted_temporal_events'], 5)
        self.assertEqual(coverage['AUTH-002']['omitted_temporal_events'], 6)
        relative = run_preview(assume_comparable_clocks=True)
        self.assertEqual(set(a['rule_id'] for a in relative['alerts']), {'AUTH-001', 'AUTH-002'})
        self.assertEqual(relative['counts']['correlations'], 1)
        self.assertTrue(all(a['depends_on_clock_assumption'] for a in relative['alerts']))
        self.assertTrue(all(link['depends_on_clock_assumption'] for a in relative['alerts'] for link in a['related']))
        self.assertEqual({a['score'] for a in relative['alerts']}, {70, 92})
        self.assertEqual(relative['options']['relative_scope_count'], 6)
        self.assertTrue(all(a['time_basis']['utc_verified'] is False for a in relative['alerts']))
        evidence = {e['id']: e for e in relative['evidence']}
        for alert in relative['alerts']:
            self.assertEqual(len(alert['evidence_ids']), alert['event_count'])
            self.assertTrue(all(evidence[eid]['raw']['Log_ID'].startswith('TEST-') for eid in alert['evidence_ids']))
        self.assertEqual(run_preview(), strict)
        self.assertEqual(before, self.state())

    def test_spraying_tracks_distinct_users_and_original_ids(self):
        seed_rows(test_rows(spraying=True))
        result = run_preview(assume_comparable_clocks=True)
        self.assertEqual([(a['rule_id'], a['score']) for a in result['alerts']], [('AUTH-003', 78)])
        self.assertEqual(len(result['evidence']), 5)
        self.assertEqual(len({e['raw']['User'] for e in result['evidence']}), 5)

    def test_absolute_time_runs_without_a_relative_assumption(self):
        seed_rows(test_rows(known_zone=True))
        result = run_preview()
        self.assertEqual(result['counts']['by_rule']['AUTH-001'], 1)
        self.assertFalse(result['alerts'][0]['depends_on_clock_assumption'])
        self.assertTrue(result['alerts'][0]['time_basis']['utc_verified'])

    def test_ports_are_not_inferred_from_descriptions_or_destination_text(self):
        rows = [fixture_row(f'TEST-NET-{index}', f'2026-10-29T10:00:{index:02}', Event_ID='5156', Result='Allowed',
                            Destination='192.0.2.50', Event_Description=f'TEST ONLY destination port {100 + index}') for index in range(10)]
        seed_rows(rows)
        result = run_preview(assume_comparable_clocks=True)
        coverage = next(rule for rule in result['coverage'] if rule['id'] == 'NET-001')
        self.assertEqual(coverage['evaluated_events'], 0)
        self.assertEqual(coverage['omitted_context_events'], 10)
        self.assertEqual(result['counts']['by_rule']['NET-001'], 0)

    def test_missing_ip_markers_remain_original_text_and_are_not_grouped_as_real_entities(self):
        rows = test_rows()
        for row in rows:
            row[HEADERS.index('Source_IP')] = '0.0.0.0'
        seed_rows(rows)
        result = run_preview(assume_comparable_clocks=True)
        self.assertEqual(result['alerts'], [])
        for marker in ('0.0.0.0', '::', '-', 'N/A', 'unknown'):
            event = {'raw': dict(zip(HEADERS, fixture_row(Source_IP=marker)))}
            adapted = adapt_event(event)
            self.assertEqual(adapted['src_ip'], '')
            self.assertEqual(event['raw']['Source_IP'], marker)

    def test_existing_port_rule_works_when_structured_ports_are_provided(self):
        rows = [fixture_row(f'TEST-PORT-{index}', f'2026-10-29T10:00:{index:02}', Event_ID='5156', Result='Allowed',
                            Destination='192.0.2.50') + [str(100 + index)] for index in range(10)]
        seed_rows(rows, ['Destination_Port'])
        result = run_preview(assume_comparable_clocks=True)
        self.assertEqual([(a['rule_id'], a['score'], a['severity']) for a in result['alerts']], [('NET-001', 58, 'medium')])

    def test_command_alert_does_not_depend_on_assumption_but_its_relation_does(self):
        seed_rows([fixture_row(f'TEST-PS-{index}', f'2026-10-29T10:00:0{index}', Process_CommandLine='powershell.exe -enc TEST-REDACTED') for index in range(2)])
        strict = run_preview()
        self.assertEqual((strict['counts']['alerts'], strict['counts']['correlations']), (2, 0))
        relative = run_preview(assume_comparable_clocks=True)
        self.assertEqual(relative['counts']['correlations'], 1)
        self.assertTrue(all(not a['depends_on_clock_assumption'] for a in relative['alerts']))
        self.assertTrue(all(link['depends_on_clock_assumption'] for a in relative['alerts'] for link in a['related']))

    def test_empty_and_synthetic_datasets_have_no_fabricated_alerts(self):
        empty = run_preview()
        self.assertEqual(empty['dataset']['event_count'], 0)
        self.assertEqual(empty['alerts'], [])
        self.assertEqual(empty['evidence'], [])
        seed_rows([fixture_row(Process_CommandLine='powershell.exe -enc TEST')], synthetic=True)
        result = run_preview()
        self.assertEqual(result['dataset']['excluded_synthetic_count'], 1)
        self.assertEqual(result['dataset']['event_count'], 0)
        self.assertEqual(result['alerts'], [])

    def test_api_is_post_only_validates_options_and_preserves_every_table(self):
        seed_rows(test_rows())
        before = self.state()
        with patch('app.storage.connection', side_effect=AssertionError('Must not open a writable connection')):
            self.assertEqual(self.request({'assume_comparable_clocks': False})[0], 200)
            self.assertEqual(self.request({'assume_comparable_clocks': True})[0], 200)
            for bad in ({'assume_comparable_clocks': 'true'}, {'assume_comparable_clocks': 1}, {'persist': True}):
                self.assertEqual(self.request(bad)[0], 422)
            self.assertEqual(self.request(method='GET')[0], 405)
            self.assertEqual(self.request(headers=[(b'origin', b'https://external.invalid')])[0], 403)
        self.assertEqual(before, self.state())

    def test_preview_is_reproducible_and_never_calls_persistent_recalculation(self):
        seed_rows([fixture_row(Process_CommandLine='powershell.exe -enc TEST')])
        before = self.state()
        with patch('app.storage.recompute', side_effect=AssertionError('No persistent recalc')), patch('app.storage.audit', side_effect=AssertionError('No audit writes')):
            first = run_preview()
            self.assertEqual(first, run_preview())
            self.assertNotEqual(first['preview_id'], run_preview(assume_comparable_clocks=True)['preview_id'])
        self.assertEqual(first['dataset']['stored_incident_count'], 1)
        self.assertEqual(before, self.state())

    def test_preview_limits_fail_without_truncating_results_or_writing(self):
        seed_rows([fixture_row(Process_CommandLine='powershell.exe -enc TEST')])
        before = self.state()
        with patch('app.preview.MAX_PREVIEW_EVENTS', 0), patch('app.preview.detect', side_effect=AssertionError('Do not run past limit')):
            with self.assertRaisesRegex(ValueError, 'hasta'):
                run_preview()
        with patch('app.preview.MAX_PREVIEW_ALERTS', 0):
            with self.assertRaisesRegex(ValueError, 'supera'):
                run_preview()
        self.assertEqual(before, self.state())

    def test_missing_database_is_not_created_by_readonly_preview(self):
        missing = Path(self.temp.name) / 'TEST-MISSING.db'
        with patch.object(storage, 'DATABASE', missing):
            with self.assertRaisesRegex(ValueError, 'No se pudo leer SQLite'):
                run_preview()
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
