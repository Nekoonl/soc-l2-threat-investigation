import asyncio
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from app import storage
from app.analysis import guided_analysis, analyze_with_ollama
from app.config import ROOT
from app.detection import correlate, detect
from app.ingestion import normalize, read_table
from app.main import app
from app.reports import make_report


def event(index, seconds=0, **kwargs):
    return {'id':index, 'timestamp':(datetime(2026,10,28,14,tzinfo=timezone.utc)+timedelta(seconds=seconds)).isoformat(),
            'src_ip':'192.0.2.10','dst_ip':'10.0.0.1','username':'ana','hostname':'pc-01','event_type':'login',
            'event_id':'4625','status':'failure','dst_port':3389,'bytes_sent':0,'message':'', **kwargs}


async def asgi_request(method,path,body=b'',headers=None):
    messages=[]
    supplied=False
    async def receive():
        nonlocal supplied
        if supplied:
            await asyncio.sleep(0)
            return {'type':'http.disconnect'}
        supplied=True
        return {'type':'http.request','body':body,'more_body':False}
    async def send(message):
        messages.append(message)
    path,_,query=path.partition('?')
    scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1','method':method,
           'scheme':'http','path':path,'raw_path':path.encode(),'query_string':query.encode(),'root_path':'',
           'server':('127.0.0.1',8000),'client':('127.0.0.1',12345),
           'headers':[(b'host',b'127.0.0.1:8000'),(b'content-length',str(len(body)).encode()),*(headers or [])]}
    await app(scope,receive,send)
    status=next(m['status'] for m in messages if m['type']=='http.response.start')
    content=b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body')
    return status,content,messages


def multipart(content,filename='logs.csv',mapping=None):
    boundary='soc-l2-boundary-test'
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+content+b'\r\n'
    if mapping is not None:
        body+=(f'--{boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n{json.dumps(mapping)}\r\n').encode()
    body+=f'--{boundary}--\r\n'.encode()
    return body,[(b'content-type',f'multipart/form-data; boundary={boundary}'.encode())]


class IngestionTests(unittest.TestCase):
    def test_csv_aliases_encoding_and_rejected_rows(self):
        content='Fecha;IP Origen;Usuario;ID Evento;Mensaje\n28/10/2026 09:00:00;192.0.2.10;Ana;4625;Contraseña fallida\nfecha-invalida;192.0.2.10;ana;4625;error\n28/10/2026 09:01:00;invalid-ip;ana;4625;error\n'.encode('cp1252')
        headers,rows=read_table('test.csv',content)
        events,errors,mapping=normalize(headers,rows)
        self.assertEqual(len(events),1)
        self.assertEqual(len(errors),2)
        self.assertEqual(events[0]['timestamp'],'2026-10-28T14:00:00+00:00')
        self.assertEqual(events[0]['username'],'ana')
        self.assertEqual(mapping['src_ip'],'IP Origen')

    def test_xlsx_datetime_and_formulas(self):
        wb=Workbook();ws=wb.active;ws.append(['timestamp','event_id']);ws.append([datetime(2026,10,28,9),4625])
        output=io.BytesIO();wb.save(output)
        events,errors,_=normalize(*read_table('test.xlsx',output.getvalue()))
        self.assertFalse(errors);self.assertEqual(events[0]['event_id'],'4625')
        ws.append(['=NOW()',4625]);output=io.BytesIO();wb.save(output)
        with self.assertRaisesRegex(ValueError,'fórmulas'):
            read_table('test.xlsx',output.getvalue())

    def test_mapping_and_invalid_file(self):
        with self.assertRaisesRegex(ValueError,'Fecha'):
            normalize(['foo','status'],[['a','failure']])
        with self.assertRaises(ValueError):
            read_table('logs.xlsx',b'not-a-zip')
        with self.assertRaises(ValueError):
            read_table('logs.exe',b'bad')
        with self.assertRaises(ValueError):
            read_table('logs.csv',b'timestamp,timestamp\na,b')

    def test_fingerprint_deduplicates_timezone_variants(self):
        headers=['timestamp','event_id','username']
        a=normalize(headers,[['2026-10-28T09:00:00-05:00','4625','ANA']])[0][0]
        b=normalize(headers,[['2026-10-28T14:00:00Z','4625','ana']])[0][0]
        self.assertEqual(a['fingerprint'],b['fingerprint'])

    def test_source_rows_survive_blank_lines_and_multiline_csv(self):
        content=b'\ntimestamp,event_id,message\n\n2026-10-28T14:00:00Z,4625,"first\nsecond"\n\n2026-10-28T14:01:00Z,4625,last\n'
        events,errors,_=normalize(*read_table('source.csv',content))
        self.assertFalse(errors)
        self.assertEqual([e['row_number'] for e in events],[4,7])


class DetectionTests(unittest.TestCase):
    def test_brute_force_sliding_window_and_boundaries(self):
        matches=detect([event(i,i*60) for i in range(5)])
        self.assertEqual([i['rule_id'] for i in matches],['AUTH-001'])
        self.assertFalse(detect([event(i,i*100) for i in range(5)]))
        # Five events crossing fixed clock buckets still match a rolling window.
        self.assertEqual(len(detect([event(i,290+i*5) for i in range(5)])),1)

    def test_success_requires_same_identity_and_preceding_failures(self):
        failures=[event(i,i*30) for i in range(5)]
        success=event(10,200,event_id='4624',status='success')
        self.assertIn('AUTH-002',[i['rule_id'] for i in detect(failures+[success])])
        for different in [event(10,-1,event_id='4624',status='success'),event(10,200,username='otra',event_id='4624',status='success')]:
            self.assertNotIn('AUTH-002',[i['rule_id'] for i in detect(failures+[different])])

    def test_spraying_and_port_scan_need_distinct_targets(self):
        spray=detect([event(i,i*30,username=f'user{i}') for i in range(5)])
        self.assertIn('AUTH-003',[i['rule_id'] for i in spray])
        ports=[event(i,i*5,event_type='connection',event_id='',status='allowed',username='',dst_port=100+i) for i in range(10)]
        self.assertEqual([i['rule_id'] for i in detect(ports)],['NET-001'])
        self.assertFalse(detect([{**e,'dst_port':443} for e in ports]))

    def test_powershell_and_no_benign_substring_match(self):
        suspicious=event(1,event_id='4104',message='powershell.exe -enc DEMO',status='observed')
        self.assertEqual(detect([suspicious])[0]['rule_id'],'EXEC-001')
        self.assertFalse(detect([event(1,event_id='4104',message='powershell.exe -File approved.ps1',status='observed')]))

    def test_successful_process_cannot_trigger_authentication_success(self):
        events=[event(i,i*30) for i in range(5)]
        events.append(event(9,200,event_type='process',event_id='4104',status='success',message='approved script'))
        self.assertNotIn('AUTH-002',[i['rule_id'] for i in detect(events)])

    def test_correlation_requires_entity_and_time(self):
        events=[event(i,i*30) for i in range(5)]+[event(9,200,event_id='4624',status='success')]
        incidents=detect(events);links=correlate(incidents,{e['id']:e for e in events})
        self.assertTrue(all(links[i['id']] for i in incidents))
        far=detect([event(100+i,10000+i*30) for i in range(5)])[0]
        combined=incidents+[far];links=correlate(combined,{e['id']:e for e in events})
        self.assertFalse(links[far['id']])


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.previous=storage.DATABASE
        storage.DATABASE=Path(self.temp.name)/'soc.db'
        storage.initialize()

    def tearDown(self):
        storage.DATABASE=self.previous
        self.temp.cleanup()

    def request(self,method,path,body=b'',headers=None):
        return asyncio.run(asgi_request(method,path,body,headers))

    def seed(self):
        status,body,_=self.request('POST','/api/demo')
        self.assertEqual(status,201,body)
        return storage.snapshot()

    def test_end_to_end_demo_triage_guided_and_reports(self):
        status,body,_=self.request('GET','/')
        self.assertEqual(status,200);self.assertIn(b'Centro de investigaci',body)
        data=self.seed();self.assertEqual(data['metrics']['events'],312)
        self.assertEqual(data['metrics']['incidents'],6)
        self.assertEqual(data['metrics']['critical'],1)
        item=data['incidents'][0]
        status,body,_=self.request('PATCH','/api/incidents/'+item['id'],json.dumps({'status':'investigating','notes':'<script>Texto literal</script>'}).encode(),[(b'content-type',b'application/json')])
        self.assertEqual(status,200,body)
        status,body,_=self.request('POST','/api/incidents/'+item['id']+'/analysis',b'{"provider":"guided"}',[(b'content-type',b'application/json')])
        self.assertEqual(status,200,body);self.assertEqual(json.loads(body)['provider'],'guided')
        for kind in ('technical','executive'):
            status,pdf,_=self.request('GET',f'/api/reports/{kind}.pdf')
            self.assertEqual(status,200,pdf[:200]);self.assertTrue(pdf.startswith(b'%PDF'));self.assertGreater(len(pdf),2000)
        status,body,_=self.request('GET','/api/events?q=finanzas&page=1')
        self.assertEqual(status,200);self.assertGreater(json.loads(body)['total'],0)

    def test_multipart_preview_import_errors_and_deduplication(self):
        content=b'timestamp,event_id,src_ip,username\n2026-10-28T14:00:00Z,4625,192.0.2.10,ana\nBAD,4625,192.0.2.10,ana\n'
        body,headers=multipart(content)
        status,preview,_=self.request('POST','/api/import/preview',body,headers)
        self.assertEqual(status,200,preview);self.assertEqual(json.loads(preview)['total'],2)
        for expected_new,expected_duplicates in [(1,0),(0,1)]:
            status,result,_=self.request('POST','/api/import',body,headers);data=json.loads(result)
            self.assertEqual(status,201,result);self.assertEqual(data['accepted'],expected_new);self.assertEqual(data['duplicates'],expected_duplicates);self.assertEqual(data['rejected'],1)
        status,_,_=self.request('POST','/api/demo')
        self.assertEqual(status,422)
        # Real evidence cannot be erased through the demo reset route.
        status,_,_=self.request('POST','/api/demo/reset',b'{"confirmation":"REINICIAR DEMO"}',[(b'content-type',b'application/json')])
        self.assertEqual(status,422);self.assertEqual(storage.snapshot()['metrics']['events'],1)

    def test_triage_survives_new_evidence_and_analysis_is_invalidated(self):
        headers=['timestamp','event_id','src_ip','username','hostname']
        def normalized(seconds):
            return normalize(headers,[[event(i,t)['timestamp'],'4625','192.0.2.10','ana','pc-01'] for i,t in enumerate(seconds)])[0]
        storage.save_import('a.csv',b'a',normalized([0,10,20,30,40]),[],{})
        first=storage.snapshot()['incidents'][0]
        storage.update_incident(first['id'],'investigating','Revisar MFA')
        analysis=guided_analysis(first);storage.save_analysis(first['id'],analysis,first['evidence_ids'])
        storage.save_import('b.csv',b'b',normalized([50]),[],{})
        updated=storage.snapshot()['incidents'][0]
        self.assertEqual(updated['id'],first['id']);self.assertEqual(updated['notes'],'Revisar MFA');self.assertEqual(updated['status'],'investigating');self.assertIsNone(updated['analysis']);self.assertEqual(updated['event_count'],6)

    def test_invalidated_analysis_does_not_write_stale_result(self):
        item=self.seed()['incidents'][0]
        with self.assertRaisesRegex(ValueError,'cambió'):
            storage.save_analysis(item['id'],guided_analysis(item),[-1])

    def test_csrf_and_input_errors(self):
        status,_,_=self.request('POST','/api/demo',headers=[(b'origin',b'https://otro-sitio.example')])
        self.assertEqual(status,403)
        status,_,_=self.request('GET','/api/events?page=bad')
        self.assertEqual(status,422)
        status,_,_=self.request('GET','/api/incidents/NO-EXISTE')
        self.assertEqual(status,404)
        status,_,_=self.request('GET','/api/reports/technical.pdf')
        self.assertEqual(status,422)

    def test_demo_reset_is_explicit_and_isolated(self):
        self.seed()
        status,_,_=self.request('POST','/api/demo/reset',b'{}',[(b'content-type',b'application/json')])
        self.assertEqual(status,422)
        status,_,_=self.request('POST','/api/demo/reset',b'{"confirmation":"REINICIAR DEMO"}',[(b'content-type',b'application/json')])
        self.assertEqual(status,200);self.assertEqual(storage.snapshot()['metrics']['events'],0)

    def test_ollama_missing_and_mocked_structured_response(self):
        item=storage.get_incident(self.seed()['incidents'][0]['id'])
        with patch('app.analysis.OLLAMA_MODEL',''):
            with self.assertRaisesRegex(ValueError,'no configurada'):
                analyze_with_ollama(item)
        result={'summary':'Resumen','hypothesis':'Hipótesis','evidence':['Evento observado'],'recommendations':['Validar MFA'],'limitations':'Sin confirmar'}
        raw=json.dumps({'message':{'content':json.dumps(result)}}).encode()
        class FakeResponse(io.BytesIO):
            pass
        with patch('app.analysis.OLLAMA_MODEL','modelo-local'),patch('urllib.request.OpenerDirector.open',return_value=FakeResponse(raw)):
            analysis=analyze_with_ollama(item)
        self.assertEqual(analysis['provider'],'ollama');self.assertEqual(analysis['summary'],'Resumen')


if __name__ == '__main__':
    unittest.main()
