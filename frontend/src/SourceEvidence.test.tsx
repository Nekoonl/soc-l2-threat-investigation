import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventsPage } from './pages/EventsPage';
import { sourceText } from './lib/source-fields';
import type { EventDetail, EventRecord } from './services/events';

function legacy(id = 1): EventRecord {
  return {
    id, import_id: 1, filename: 'TEST-LEGACY.xlsx', file_sha256: 'a'.repeat(64), synthetic: false,
    timestamp: '2026-10-29T15:00:00+00:00', src_ip: '192.0.2.20', dst_ip: '',
    username: 'test-user', hostname: 'test-host', event_id: '4625', event_type: '', status: 'Failure', message: '', row_number: id + 1,
    raw: { Log_ID: `TEST-ORIGINAL-${id}`, Timestamp: '2026-10-29 10:00:00', Hostname: 'TEST-HOST', Event_ID: '4625',
      User: 'TEST-USER', Source_IP: '192.0.2.20', Destination: '', Log_Source: 'Security',
      Event_Description: 'TEST ONLY original description', Process_CommandLine: '', Result: 'Failure', Severity: 'Warning' },
  };
}
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function mockEvents(records: EventRecord[], detail?: EventDetail) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/events/options') return json({ log_source: ['Security'], hostname: ['TEST-HOST'], status: ['Failure'], source_severity: ['Warning'], imports: [] });
    if (url === '/api/events/1' && detail) return json(detail);
    return json({ events: records, total: records.length, dataset_total: records.length, page: 1, pages: 1, page_size: 25 });
  }));
}

describe('Valores originales de evidencia', () => {
  it('prioriza el identificador original sobre un valor normalizado contradictorio', () => {
    const event = { ...legacy(), log_id: 'WRONG NORMALIZED ID' };
    expect(sourceText(event, 'log_id')).toBe('TEST-ORIGINAL-1');
    expect(event.log_id).toBe('WRONG NORMALIZED ID');
  });

  it('distingue una celda vacía de una columna ausente y conserva marcadores de origen', () => {
    const event = legacy();
    event.destination = 'WRONG FALLBACK';
    expect(sourceText(event, 'destination', 'WRONG FALLBACK')).toBe('Vacío en el archivo');
    delete event.raw.Destination;
    event.destination = '';
    expect(sourceText(event, 'destination')).toBe('No indicado en origen');
    event.raw.Source_IP = 'N/A';
    expect(sourceText(event, 'src_ip')).toBe('N/A');
    // Keep the existing generic CSV fallback, but never override a source cell that exists.
    delete event.raw.Event_ID;
    event.event_id = '';
    expect(sourceText(event, 'event_id', 'connection')).toBe('connection');
    event.raw.Event_ID = '';
    expect(sourceText(event, 'event_id', 'connection')).toBe('Vacío en el archivo');
  });

  it('utiliza la proyección documentada para encabezados personalizados', () => {
    const event = legacy();
    delete event.raw.Log_Source;
    event.raw.CUSTOM_SOURCE = 'TEST SOURCE';
    event.source_values = { log_source: 'TEST SOURCE' };
    expect(sourceText(event, 'log_source')).toBe('TEST SOURCE');
  });

  it('renderiza identificador, fuente, severidad, hora original y procedencia heredada sin afirmar autenticidad', async () => {
    const event = legacy();
    const detail: EventDetail = {
      ...event, occurrences: [],
      provenance: { legacy_normalization: true, original_file_stored: false, import_created_at: '2026-10-29T16:32:57+00:00', declared_timezone: null },
      stored_normalized: { timestamp: event.timestamp, hostname: event.hostname, message: event.message },
    };
    mockEvents([event], detail);
    const user = userEvent.setup();
    render(<EventsPage />);
    expect(await screen.findByText('TEST-ORIGINAL-1')).toBeInTheDocument();
    const dataRow = screen.getAllByRole('row')[1];
    expect(within(dataRow).getByText('Security')).toBeInTheDocument();
    expect(within(dataRow).getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('2026-10-29 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('Zona no indicada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver evento TEST-ORIGINAL-1' }));
    await screen.findByText(/El archivo binario original no se conservó/);
    expect(screen.getByText(/Registro de importación #1/)).toBeInTheDocument();
    expect(screen.getByText('Declaración de zona del archivo')).toBeInTheDocument();
    expect(screen.getByText('Sin declaración registrada')).toBeInTheDocument();
    expect(screen.getByText(/La fecha original no establece un instante UTC/)).toBeInTheDocument();
    expect(screen.getByText('Log_ID: TEST-ORIGINAL-1')).toBeInTheDocument();
    expect(screen.getByText('TEST ONLY original description', { selector: 'pre' })).toBeInTheDocument();
    await user.click(screen.getByText('Valores normalizados almacenados — sin modificar'));
    expect(screen.getByText('2026-10-29T15:00:00+00:00')).toBeInTheDocument();
  });

  it('mantiene la diferencia visual entre un destino vacío y otro no documentado', async () => {
    const empty = legacy(1), missing = legacy(2);
    delete missing.raw.Destination;
    mockEvents([empty, missing]);
    render(<EventsPage />);
    await screen.findByText('TEST-ORIGINAL-2');
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Vacío en el archivo')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No indicado en origen')).toBeInTheDocument();
  });
});
