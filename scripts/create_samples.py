"""Generate deterministic synthetic logs using documentation-only IP ranges."""
import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ['timestamp', 'src_ip', 'dst_ip', 'username', 'hostname', 'event_type', 'event_id', 'status', 'dst_port', 'bytes_sent', 'message']


def create():
    start = datetime(2026, 10, 28, 8, 0, tzinfo=timezone(timedelta(hours=-5)))
    rows = []

    def add(minutes, **values):
        row = {field: '' for field in FIELDS}
        row.update(timestamp=(start + timedelta(minutes=minutes)).isoformat(), bytes_sent=0)
        row.update(values)
        rows.append(row)

    for i in range(280):
        add(i*0.6, src_ip=f'10.20.0.{10+i%12}', dst_ip='10.20.0.5', username=f'analista.{i%12+1:02}', hostname=f'ws-{i%12+1:02}',
            event_type='connection', status='allowed', dst_port=443, message='[SINTETICO] Conexion de aplicacion corporativa', bytes_sent=800+i*13)
    for i in range(8):
        add(42+i*0.4, src_ip='192.0.2.45', dst_ip='10.20.0.15', username='m.rodriguez', hostname='ws-finanzas', event_type='login',
            event_id='4625', status='failure', dst_port=3389, message='[SINTETICO] Error de inicio de sesion: credenciales incorrectas')
    add(46, src_ip='192.0.2.45', dst_ip='10.20.0.15', username='m.rodriguez', hostname='ws-finanzas', event_type='login',
        event_id='4624', status='success', dst_port=3389, message='[SINTETICO] Inicio de sesion exitoso posterior a multiples fallos')
    add(48, src_ip='192.0.2.45', dst_ip='10.20.0.15', username='m.rodriguez', hostname='ws-finanzas', event_type='process',
        event_id='4104', status='observed', message='[SINTETICO - NO EJECUTAR] powershell.exe -EncodedCommand DEMO_NO_ES_UN_COMANDO_VALIDO')
    for i, port in enumerate([21,22,23,25,53,80,110,135,139,443,445,1433,3389,8080]):
        add(50+i*0.07, src_ip='192.0.2.45', dst_ip='10.20.0.8', hostname='srv-interno', event_type='connection', status='denied',
            dst_port=port, message='[SINTETICO] Intento de conexion hacia servicio interno')
    for i in range(7):
        add(105+i*0.5, src_ip='198.51.100.23', dst_ip='10.20.0.5', username=f'cuenta.{i+1}', hostname='srv-identidad', event_type='login',
            event_id='4625', status='failure', dst_port=443, message='[SINTETICO] Fallo de autenticacion contra diferentes cuentas')
    add(130, src_ip='10.20.0.25', dst_ip='10.20.0.5', username='svc.actualizacion', hostname='srv-app', event_type='process', event_id='4104', status='observed',
        message='[SINTETICO - NO EJECUTAR] powershell.exe -ExecutionPolicy Bypass -File C:\\Demo\\actualizacion.ps1')
    rows.sort(key=lambda r:r['timestamp'])
    (ROOT/'samples').mkdir(exist_ok=True)
    with (ROOT/'samples'/'escenario_soc.csv').open('w',newline='',encoding='utf-8-sig') as file:
        writer = csv.DictWriter(file,fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f'Escenario sintetico: {len(rows)} eventos.')


if __name__ == '__main__':
    create()
