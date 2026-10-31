"""PDF structure/content and server-preview provenance. All data writes use temp DBs."""
import asyncio
import json
import re
import tempfile
import unittest
from collections import OrderedDict
from pathlib import Path
from unittest.mock import patch

from app import storage, preview_store
from app.dashboard import get_dashboard_summary
from app.report_data import build_report_data
from app.reports import make_report
from app.ingestion import normalize, suggest_mapping
from scripts.audit_data import audit_database
from tests.test_import_events import fixture_row
from tests.test_preview import seed_rows
from tests.test_platform import asgi_request


def pdf_text(content):
    """Inspect ReportLab's uncompressed ASCII text runs, not a general PDF reader."""
    def unescape(value):
        return re.sub(rb'\\([0-7]{1,3}|.)', lambda match: bytes([int(match[1], 8)]) if match[1][:1].isdigit() else match[1], value)
    return ''.join(unescape(value).decode('latin-1') for value in re.findall(rb'\(((?:\\.|[^\\)])*)\)\s*Tj', content))


def assert_pdf(test, content):
    test.assertTrue(content.startswith(b'%PDF-1.4'))
    test.assertTrue(content.rstrip().endswith(b'%%EOF'))
    test.assertGreater(len(content), 2000)
    offset = int(re.search(rb'startxref\s+(\d+)', content)[1])
    test.assertEqual(content[offset:offset+4], b'xref')
    entries = re.search(rb'xref\s+0\s+(\d+)\s*\r?\n(.*?)trailer', content, re.S)
    test.assertIsNotNone(entries)
    lines = entries[2].splitlines()
    test.assertEqual(len(lines), int(entries[1]))
    for object_id, line in enumerate(lines[1:], start=1):
        target = int(line[:10])
        test.assertTrue(content[target:].startswith(f'{object_id} 0 obj'.encode()))
    return len(re.findall(rb'/Type\s*/Page\b', content))


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'TEST-REPORT.db'
        self.database_patch = patch.object(storage, 'DATABASE', self.database)
        self.cache_patch = patch.object(preview_store, '_entries', OrderedDict())
        self.database_patch.start(); self.cache_patch.start(); storage.initialize()

    def tearDown(self):
        self.cache_patch.stop(); self.database_patch.stop(); self.temp.cleanup()

    def state(self):
        return audit_database(self.database)['state']

    def api(self, kind='technical', body=None, *, method='POST', extra_headers=()):
        return asyncio.run(asgi_request(method, f'/api/reports/{kind}.pdf', json.dumps(body or {}).encode(),
                                       [(b'content-type', b'application/json'), *extra_headers]))

    def preview(self, relative=False):
        status, body, _ = asyncio.run(asgi_request('POST', '/api/detections/preview', json.dumps({'assume_comparable_clocks': relative}).encode(), [(b'content-type', b'application/json')]))
        self.assertEqual(status, 200)
        return json.loads(body)

    def seed_command(self, command='powershell.exe -EncodedCommand TEST_REDACTED', **values):
        seed_rows([fixture_row('TEST-EVT-0001', '2026-10-29 10:00:00', Event_ID='4688',
                              Severity='Informational', Process_CommandLine=command, **values)])

    def test_both_pdf_kinds_without_preview_explicitly_leave_detections_unevaluated(self):
        self.seed_command(); before = self.state()
        for kind in ('technical', 'executive'):
            with patch('app.main.run_preview', side_effect=AssertionError('No automatic preview')), patch('app.preview.detect', side_effect=AssertionError('No new detection')), patch('app.storage.connection', side_effect=AssertionError('No write connection')):
                status, content, messages = self.api(kind)
            self.assertEqual(status, 200)
            self.assertGreaterEqual(assert_pdf(self, content), 2)
            text = pdf_text(content)
            self.assertIn('Detecciones no evaluadas', text)
            self.assertNotIn('ALR-', text)
            headers = dict(next(message['headers'] for message in messages if message['type'] == 'http.response.start'))
            self.assertEqual(headers[b'content-type'], b'application/pdf')
            self.assertIn(b'attachment', headers[b'content-disposition'])
        self.assertEqual(before, self.state())

    def test_executed_server_preview_has_original_evidence_priority_and_safe_time(self):
        self.seed_command()
        with storage.connection() as db:
            row = db.execute('SELECT * FROM events').fetchone(); data = json.loads(row['data'])
            data['timestamp'] = '1999-01-01T15:00:00+00:00'; data['message'] = ''
            db.execute('UPDATE events SET data=? WHERE id=?', (json.dumps(data), row['id']))
            db.execute("INSERT INTO incidents(id,data,status,notes,updated_at) VALUES('TEST-HISTORICAL','{}','resolved','TEST preserve','2026-10-29T10:00:00Z')")
        preview = self.preview(); before = self.state()
        scope = {'preview_id': preview['preview_id'], 'dataset_revision': preview['dataset']['revision']}
        with patch('app.main.run_preview', side_effect=AssertionError('No automatic preview')), patch('app.preview.detect', side_effect=AssertionError('No new detection')), patch('app.storage.recompute', side_effect=AssertionError('No persistent recalc')), patch('app.storage.audit', side_effect=AssertionError('No audit writes')), patch('app.storage.connection', side_effect=AssertionError('No write connection')):
            status, content, _ = self.api(body=scope)
        self.assertEqual(status, 200); assert_pdf(self, content)
        text = pdf_text(content)
        self.assertIn('TEST-EVT-0001', text)
        self.assertIn('2026-10-29 10:00:00', text)
        self.assertIn('Zona no indicada', text)
        self.assertIn('Informational', text)
        self.assertIn('82/100', text)
        self.assertIn('powershell.exe', text)
        self.assertNotIn('1999-01-01', text)
        self.assertNotIn('TEST-HISTORICAL', text)
        model = build_report_data(**{'preview_id': preview['preview_id']})
        self.assertEqual(model['preview']['evidence'][0]['raw']['Log_ID'], 'TEST-EVT-0001')
        self.assertIn(model['sources'][0]['sha256'], text)
        self.assertEqual(before, self.state())

    def test_executive_and_technical_are_distinct_documents(self):
        self.seed_command(); preview = self.preview()
        data = build_report_data(preview_id=preview['preview_id'])
        technical = make_report(data, 'technical'); executive = make_report(data, 'executive')
        self.assertIn('Process_CommandLine', pdf_text(technical))
        self.assertNotIn('Process_CommandLine', pdf_text(executive))
        self.assertNotEqual(technical, executive)
        self.assertIn('Conclusi', pdf_text(executive))
        self.assertIn('Reglas no evaluadas', pdf_text(executive))
        self.assertIn('Detecciones no evaluadas', pdf_text(make_report(build_report_data())))

    def test_executive_distinguishes_alerts_of_the_same_rule_with_server_evidence(self):
        seed_rows([fixture_row('TEST-EVT-A', Event_ID='4688', Process_CommandLine='powershell.exe -enc TEST_A'),
                   fixture_row('TEST-EVT-B', Event_ID='4688', Process_CommandLine='powershell.exe -enc TEST_B')])
        preview = self.preview(); before = self.state()
        self.assertEqual([item['rule_id'] for item in preview['alerts']], ['EXEC-001', 'EXEC-001'])
        with patch('app.main.run_preview', side_effect=AssertionError('No automatic preview')), patch('app.preview.detect', side_effect=AssertionError('No new detection')), patch('app.storage.connection', side_effect=AssertionError('No write connection')):
            status, content, _ = self.api('executive', {'preview_id': preview['preview_id']})
        self.assertEqual(status, 200); assert_pdf(self, content)
        text = pdf_text(content)
        for event in preview['evidence']:
            self.assertIn(event['raw']['Log_ID'], text)
            self.assertIn(f"ID interno {event['id']}", text)
        for alert in preview['alerts']:
            self.assertIn(alert['id'], text)
        self.assertIn('Alta (82/100)', text)
        self.assertNotIn('TEST_A', text)  # Executive references evidence without full commands.
        self.assertEqual(before, self.state())

    def test_scope_explains_four_requests_of_one_content_without_duplicating_records(self):
        for _ in range(4):
            self.seed_command()
        model = build_report_data(); before = self.state()
        self.assertEqual(model['summary']['import_request_count'], 4)
        self.assertEqual(model['summary']['total_events'], 1)
        self.assertEqual(len({row['sha256'] for row in model['sources']}), 1)
        for kind in ('technical', 'executive'):
            text = pdf_text(make_report(model, kind))
            compact = re.sub(r'\s+', '', text)
            self.assertIn('4solicitudes', compact)
            self.assertIn('Las4solicitudescorrespondenaunmismocontenidodearchivo.', compact)
            self.assertIn('Losduplicadosnoaumentaneltotal', compact)
            self.assertNotIn('1 contenidos', text)
            if kind == 'technical':
                # Four short provenance tables must not split into five fragments.
                self.assertEqual(compact.count('METADATOVALORREGISTRADO'), 4)
        self.assertEqual(before, self.state())

    def test_singular_scope_and_priority_are_consistent_in_both_reports(self):
        self.seed_command(); preview = self.preview()
        model = build_report_data(preview_id=preview['preview_id'])
        for kind in ('technical', 'executive'):
            text = pdf_text(make_report(model, kind))
            self.assertIn('Se registra 1 solicitud', text)
            self.assertIn('1 identidad de host', text)
            self.assertIn('1 usuario', text)
            self.assertIn('Se incluye 1 alerta preliminar', text)
            for incorrect in ('1 solicitudes', '1 identidades', '1 usuarios', '1 contenidos', 'Se incluyen 1 alertas'):
                self.assertNotIn(incorrect, text)
        self.assertIn('Prioridad Alta', pdf_text(make_report(model, 'technical')))

    def test_multiple_sources_are_not_misrepresented_as_repeated_identical_content(self):
        self.seed_command()
        seed_rows([fixture_row('TEST-SECOND-CONTENT')])
        model = build_report_data()
        self.assertEqual(model['summary']['source_file_count'], 2)
        self.assertEqual(len({row['sha256'] for row in model['sources']}), 2)
        for kind in ('technical', 'executive'):
            text = pdf_text(make_report(model, kind))
            self.assertIn('2 contenidos de archivo', text)
            self.assertNotIn('un mismo contenido', text)

    def test_custom_csv_headers_and_generic_commands_remain_traceable(self):
        headers = ['timestamp', 'event_id', 'message', 'src_ip', 'hostname', 'username', 'CUSTOM_ID']
        row = ['2026-10-29T10:00:00', '4688', 'powershell.exe -enc TEST_CUSTOM_COMMAND', '192.0.2.10', 'TEST-HOST', 'TEST-USER', 'TEST-CUSTOM-ID']
        mapping = suggest_mapping(headers); mapping['log_id'] = 'CUSTOM_ID'
        events, errors, _ = normalize(headers, [row], mapping, source_timezone=None)
        self.assertFalse(errors)
        storage.save_import('TEST-CUSTOM.csv', b'TEST ONLY', events, errors, mapping, run_detection=False)
        preview = self.preview()
        status, content, _ = self.api(body={'preview_id': preview['preview_id']})
        self.assertEqual(status, 200)
        text = pdf_text(content)
        self.assertIn('TEST-CUSTOM-ID', text)
        self.assertIn('TEST_CUSTOM_COMMAND', text)
        self.assertIn('CUSTOM_ID', text)

    def test_fake_client_findings_or_unknown_reference_are_rejected(self):
        self.seed_command(); before = self.state()
        for body in ({'alerts': [{'title': 'FAKE'}]}, {'assume_comparable_clocks': True}, {'preview_id': 'PREV-NOT-EXECUTED'}, {'preview_id': 1}, {'dataset_revision': ''}):
            status, _, _ = self.api(body=body)
            self.assertEqual(status, 422)
        self.assertEqual(before, self.state())

    def test_stale_and_expired_previews_do_not_silently_recalculate_or_omit_alerts(self):
        self.seed_command(); preview = self.preview()
        with patch('app.preview_store.time.monotonic', return_value=10**20):
            status, body, _ = self.api(body={'preview_id': preview['preview_id']})
            self.assertEqual(status, 422); self.assertIn('expir', json.loads(body)['error'])
        preview = self.preview()
        seed_rows([fixture_row('TEST-NEW')])
        before = self.state()
        for body in ({'preview_id': preview['preview_id']}, {'dataset_revision': preview['dataset']['revision']}):
            with patch('app.preview.detect', side_effect=AssertionError('No silent rerun')):
                self.assertEqual(self.api(body=body)[0], 422)
        self.assertEqual(before, self.state())

    def test_relative_assumption_is_exported_only_from_executed_preview(self):
        self.seed_command(); preview = self.preview(relative=True)
        model = build_report_data(preview_id=preview['preview_id'])
        self.assertTrue(model['preview']['options']['assume_comparable_clocks'])
        text = pdf_text(make_report(model))
        self.assertIn('relojes comparables', text)
        self.assertIn('sincronizaci', text)
        self.assertIn('Zona no indicada', text)

    def test_empty_dataset_invalid_kind_and_foreign_origin_have_clear_errors(self):
        self.assertEqual(self.api()[0], 422)
        self.assertEqual(self.api(kind='unknown')[0], 404)
        self.assertEqual(self.api(extra_headers=[(b'origin', b'https://external.invalid')])[0], 403)
        self.assertEqual(self.api(method='DELETE')[0], 405)

    def test_html_controls_unicode_and_long_rows_preserve_tail_and_paginate(self):
        command = 'powershell.exe -enc ' + 'A'*9000 + ' TEST_TAIL_MARKER <img src="https://external.invalid/x">'
        self.seed_command(command, Hostname='TEST-' + 'H'*2500, Event_Description='TEST descripción ñ \x01 ' + 'X'*1000)
        preview = self.preview(); before = self.state()
        model = build_report_data(preview_id=preview['preview_id'])
        with patch('urllib.request.urlopen', side_effect=AssertionError('Never fetch log content')):
            content = make_report(model)
        self.assertGreaterEqual(assert_pdf(self, content), 4)
        text = pdf_text(content)
        self.assertIn('TEST_TAIL_MARKER', text)
        self.assertIn('<img src=', text)
        self.assertIn('\\u0001', text)
        self.assertEqual(model['preview']['evidence'][0]['raw']['Process_CommandLine'], command)
        self.assertEqual(before, self.state())

    def test_synthetic_legacy_get_is_labelled_but_react_post_excludes_demo_data(self):
        seed_rows([fixture_row('TEST-DEMO')], synthetic=True)
        self.assertEqual(self.api()[0], 422)
        status, content, _ = self.api(method='GET')
        self.assertEqual(status, 200); assert_pdf(self, content)
        self.assertIn('LABORATORIO DEMO', pdf_text(content))

    def test_cache_is_bounded_and_keeps_immutable_server_data(self):
        self.seed_command(); original = self.preview(); reference = original['preview_id']
        original['alerts'][0]['title'] = 'CLIENT CHANGED'
        self.assertNotEqual(preview_store.resolve(reference, original['dataset']['revision'])['alerts'][0]['title'], 'CLIENT CHANGED')
        with patch('app.preview_store.MAX_PREVIEWS', 2):
            for index in range(3):
                record = {**original, 'preview_id': f'TEST-CACHE-{index}'}
                preview_store.remember(record)
            self.assertEqual(len(preview_store._entries), 2)

    def test_limits_return_errors_without_partial_files_or_database_writes(self):
        self.seed_command(); preview = self.preview(); before = self.state()
        with patch('app.report_data.MAX_REPORT_ALERTS', 0):
            self.assertEqual(self.api(body={'preview_id': preview['preview_id']})[0], 422)
        with patch('app.reports.MAX_REPORT_CHARACTERS', 100):
            self.assertEqual(self.api()[0], 422)
        self.assertEqual(before, self.state())


if __name__ == '__main__':
    unittest.main()
