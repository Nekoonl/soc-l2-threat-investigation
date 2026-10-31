import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportPage } from './pages/ImportPage';
import { EventsPage } from './pages/EventsPage';
import type { EventDetail, EventRecord, ImportResult } from './services/events';

// Explicit test fixtures, supplied only through mocked fetch in jsdom.
const importResult: ImportResult = {
  id: 1, filename: 'TEST-ONLY.csv', sha256: 'a'.repeat(64), accepted: 2, duplicates: 1, rejected: 1,
  total_rows: 4, errors: [{ row: 5, error: 'Fecha inválida', log_id: 'TEST-BAD' }], error_count: 1,
  mapping: { log_id: 'Log_ID', timestamp: 'Timestamp' }, source_timezone: null,
  sheet_name: null, analysis_ran: false, unknown_timezone: 2, unmapped_columns: [],
};
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => body });
const record = (id: number): EventRecord => ({
  id, import_id: 1, filename: 'TEST-ONLY.csv', file_sha256: 'a'.repeat(64), synthetic: false,
  timestamp: '2026-10-29T10:00:00', timestamp_original: '2026-10-29 10:00:00', timestamp_utc: null,
  timezone_status: 'unknown', log_id: `TEST-${String(id).padStart(3, '0')}`,
  src_ip: '192.0.2.10', dst_ip: '', destination: 'test.invalid', username: 'test-user', hostname: 'test-host',
  event_id: '4625', event_type: '', status: 'Failure', log_source: 'Windows Security', source_severity: 'High',
  message: 'TEST ONLY', event_description: 'TEST ONLY description', process_commandline: '<script>TEST ONLY</script>',
  raw: { Log_ID: `TEST-${String(id).padStart(3, '0')}`, Process_CommandLine: '<script>TEST ONLY</script>' }, row_number: id + 1,
});

describe('Importación y explorador conectados', () => {
  it('envía solo tras el clic, bloquea una segunda carga y presenta los contadores reales de la respuesta', async () => {
    let finish: ((value: ReturnType<typeof response>) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ImportPage />);
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['TEST ONLY'], 'TEST-ONLY.csv'));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Importar registros' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Importando…' })).toBeDisabled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/import');
    expect(init.method).toBe('POST');
    expect(init.body.get('file').name).toBe('TEST-ONLY.csv');
    expect(init.body.has('source_timezone')).toBe(false);
    await act(async () => { finish?.(response(importResult)); });
    expect(await screen.findByRole('region', { name: 'Resultado de la importación' })).toHaveTextContent('Registros importados');
    expect(screen.getByText('Importados').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Duplicados').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Rechazados').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText(/Fila 5 · Log_ID TEST-BAD/)).toBeInTheDocument();
    expect(screen.getByText(/no se convirtieron a UTC/)).toBeInTheDocument();
  });

  it('envía una zona solo cuando el usuario la declara y muestra errores sin afirmar una importación exitosa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: 'Archivo inválido' }, false));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ImportPage />);
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['TEST ONLY'], 'TEST-ONLY.xlsx'));
    await user.selectOptions(screen.getByLabelText('Zona horaria de fechas sin offset'), 'UTC');
    await user.click(screen.getByRole('button', { name: 'Importar registros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Archivo inválido');
    expect(fetchMock.mock.calls[0][1].body.get('source_timezone')).toBe('UTC');
    expect(screen.queryByRole('region', { name: 'Resultado de la importación' })).not.toBeInTheDocument();
  });

  it('conserva el resumen de una respuesta con todas las filas rechazadas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...importResult, accepted: 0, duplicates: 0, rejected: 4, error: 'No hay filas válidas.' }, false)));
    const user = userEvent.setup();
    render(<ImportPage />);
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['TEST ONLY'], 'TEST-ONLY.csv'));
    await user.click(screen.getByRole('button', { name: 'Importar registros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay filas válidas.');
    expect(screen.getByText('Archivo conservado sin filas válidas')).toBeInTheDocument();
    expect(screen.getByText('Rechazados').nextElementSibling).toHaveTextContent('4');
  });

  it('pagina, consulta filtros y abre evidencia con procedencia y texto sin ejecutar', async () => {
    const records = Array.from({ length: 26 }, (_, index) => record(index + 1));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/events/options') return response({ log_source: ['Windows Security'], hostname: ['test-host'], status: ['Failure'], source_severity: ['High'], imports: [{ id: 1, filename: 'TEST-ONLY.csv', accepted: 26, duplicates: 0, rejected: 0, created_at: '2026-10-29T10:00:00Z' }] });
      if (url === '/api/events/26') {
        const detail: EventDetail = { ...record(26), occurrences: [{ id: 1, import_id: 1, row_number: 27, sheet_name: null, source_log_id: 'TEST-026', filename: 'TEST-ONLY.csv', sha256: 'a'.repeat(64), created_at: '2026-10-29T10:00:00Z', raw: record(26).raw }] };
        return response(detail);
      }
      const params = new URL(url, 'http://localhost').searchParams;
      const page = Number(params.get('page'));
      return response({ events: page === 2 ? records.slice(25) : records.slice(0, 25), total: 26, dataset_total: 26, page, page_size: 25, pages: 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<EventsPage />);
    await screen.findByText('TEST-001');
    expect(screen.getByText('26 eventos almacenados')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    await screen.findByText('TEST-026');
    expect(screen.getByText('26–26 de 26 coincidencias')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver evento TEST-026' }));
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del evento' });
    await screen.findByText('Primera procedencia: TEST-ONLY.csv · fila 27.');
    expect(dialog.querySelector('script')).toBeNull();
    expect(screen.getAllByText('<script>TEST ONLY</script>').length).toBeGreaterThan(0);
    expect(screen.getByText('Log_ID: TEST-026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar detalle del evento' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filtrar por origen de eventos'), 'Windows Security');
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('log_source=Windows+Security'))).toBe(true));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar eventos' }), 'TEST-026');
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('q=TEST-026'))).toBe(true));
    expect(fetchMock.mock.calls.filter(call => String(call[0]).startsWith('/api/events?')).every(call => String(call[0]).includes('real_only=1'))).toBe(true);
  });

  it('muestra un error de consulta y permite reintentar sin inventar un dataset vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Servidor no disponible')));
    render(<EventsPage />);
    await screen.findByRole('button', { name: 'Reintentar consulta' });
    expect(screen.getByText('Consulta no disponible')).toBeInTheDocument();
    expect(screen.queryByText('0 eventos almacenados')).not.toBeInTheDocument();
  });
});
