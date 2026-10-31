import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { isDashboardSummary } from './services/dashboard';
import { ChartBoundary } from './components/ChartBoundary';
import fixtures from './test/fixtures/dashboard-data.json';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: { width: 600, height: 270 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 270, top: 0, left: 0, right: 600, bottom: 270, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => vi.restoreAllMocks());
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function mockApi(summary: unknown = fixtures.summary) {
  const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/dashboard/summary') return json(summary);
    if (url === '/api/health') return json({ status: 'ok', app: 'SOC L2', version: 'TEST', timezone: 'America/Panama' });
    if (url === '/api/detections/preview') return json(JSON.parse(String(init?.body)).assume_comparable_clocks ? fixtures.relative : fixtures.preview);
    throw new Error('TEST unexpected endpoint: ' + url);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const metric = (title: string) => within(screen.getByRole('region', { name: title }));
async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: 'Investigaciones' }));
  await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
  await screen.findByText('8 eventos · 2 alertas · 0 relaciones');
}

describe('Dashboard agregado y sesión de investigación', () => {
  it('contiene errores de gráficos sin desmontar el contenido del espacio de trabajo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenChart(): never { throw new Error('TEST ONLY chart failure'); }
    render(<><p>TEST: métricas disponibles</p><ChartBoundary><BrokenChart /></ChartBoundary></>);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron mostrar los gráficos');
    expect(screen.getByText('TEST: métricas disponibles')).toBeInTheDocument();
  });
  it('valida totales y rechaza severidades incoherentes o incidentes confirmados artificiales', () => {
    expect(isDashboardSummary(fixtures.summary)).toBe(true);
    expect(isDashboardSummary(fixtures.empty)).toBe(true);
    expect(isDashboardSummary({ ...fixtures.summary, total_events: 715 })).toBe(false);
    expect(isDashboardSummary({ ...fixtures.summary, severity_original: [] })).toBe(false);
    expect(isDashboardSummary({ ...fixtures.summary, confirmed_incidents: 1 })).toBe(false);
  });

  it('renderiza métricas, gráficos Recharts, datos accesibles y severidad original', async () => {
    const fetch = mockApi(); render(<App />);
    await screen.findByText('Dataset conectado');
    expect(metric('Eventos importados').getByText('8')).toBeInTheDocument();
    expect(metric('Hosts presentes').getByText('1')).toBeInTheDocument();
    expect(metric('Usuarios presentes').getByText('1')).toBeInTheDocument();
    expect(metric('Alertas preliminares').getByText('—')).toBeInTheDocument();
    // Recharts is a lazy chunk; its first transform can exceed RTL's 1s default.
    await screen.findByRole('figure', { name: 'Distribución por severidad original' }, { timeout: 5000 });
    expect(screen.getByRole('figure', { name: 'Eventos por fuente' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('figure', { name: 'Eventos por host' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Resultados de autenticación' })).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
    expect(fetch.mock.calls.every(call => ['/api/health', '/api/dashboard/summary'].includes(call[0]))).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByText('Ver datos de distribución por severidad original'));
    expect(screen.getByRole('table', { name: 'Distribución por severidad original' })).toHaveTextContent('Informational');
  });

  it('mantiene métricas pendientes durante la carga sin fabricar ceros', async () => {
    let resolve!: (value: unknown) => void;
    const fetch = mockApi();
    fetch.mockImplementation(async (url: string) => url === '/api/dashboard/summary' ? new Promise(value => { resolve = value; }) : json({ status: 'ok', app: 'TEST', version: 'TEST', timezone: 'UTC' }));
    render(<App />);
    expect(await screen.findByText('Cargando métricas agregadas…')).toBeInTheDocument();
    expect(metric('Eventos importados').getByText('—')).toBeInTheDocument();
    await act(async () => resolve(json(fixtures.summary)));
    expect(metric('Eventos importados').getByText('8')).toBeInTheDocument();
  });

  it('distingue una base vacía confirmada de un resumen sin consultar', async () => {
    mockApi(fixtures.empty); render(<App />);
    await screen.findByText('Sin eventos importados');
    expect(metric('Eventos importados').getByText('0')).toBeInTheDocument();
    expect(metric('Alertas preliminares').getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Vista previa SOC pendiente')).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
  });

  it('maneja respuestas incompatibles, desconexión y reintento sin pantalla vacía', async () => {
    const fetch = mockApi({ total_events: 715 });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('incompleto o incoherente');
    expect(metric('Eventos importados').getByText('—')).toBeInTheDocument();
    fetch.mockImplementationOnce(async () => { throw new Error('TEST sin conexión'); });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actualizar resumen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('TEST sin conexión');
    fetch.mockResolvedValueOnce(json(fixtures.summary));
    await user.click(screen.getByRole('button', { name: 'Actualizar resumen' }));
    await screen.findByText('Dataset conectado');
    expect(screen.getByRole('heading', { name: 'Visión general de seguridad' })).toBeInTheDocument();
  });

  it('reutiliza el resumen al navegar y cuenta solo una vista previa ejecutada manualmente', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); render(<App />);
    await screen.findByText('Dataset conectado');
    await user.click(screen.getByRole('link', { name: 'Configuración' }));
    await user.click(screen.getByRole('link', { name: 'Resumen' }));
    expect(fetch.mock.calls.filter(call => call[0] === '/api/dashboard/summary')).toHaveLength(1);
    await openPreview(user);
    await user.click(screen.getByRole('link', { name: 'Resumen' }));
    expect(metric('Alertas preliminares').getByText('2')).toBeInTheDocument();
    expect(screen.getByText('TEST-PS-1')).toBeInTheDocument();
    expect(screen.getByText('TEST-PS-2')).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(call => call[0] === '/api/dashboard/summary')).toHaveLength(1);
    expect(fetch.mock.calls.filter(call => call[0] === '/api/detections/preview')).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: 'Investigaciones' }));
    expect(screen.getAllByRole('button', { name: /Investigar alerta/ })).toHaveLength(2);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('invalida alertas antiguas cuando un resumen actualizado tiene otra revisión', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); render(<App />);
    await screen.findByText('Dataset conectado'); await openPreview(user);
    await user.click(screen.getByRole('link', { name: 'Resumen' }));
    fetch.mockResolvedValueOnce(json({ ...fixtures.summary, dataset_revision: 'f'.repeat(64) }));
    await user.click(screen.getByRole('button', { name: 'Actualizar resumen' }));
    await screen.findByText('Dataset conectado');
    expect(metric('Alertas preliminares').getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Vista previa SOC pendiente')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(call => call[0] === '/api/detections/preview')).toHaveLength(1);
  });

  it('etiqueta una vista relativa ya ejecutada sin activarla al volver a Incidentes', async () => {
    mockApi(); const user = userEvent.setup(); window.location.hash = '#/incidentes'; render(<App />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 4 alertas · 6 relaciones');
    await user.click(screen.getByRole('link', { name: 'Resumen' }));
    await screen.findByText('Dataset conectado');
    expect(metric('Alertas preliminares').getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/Vista bajo hipótesis explícita de relojes comparables/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Investigaciones' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Sin vista previa ejecutada')).toBeInTheDocument();
  });

  it('invalida caché y alertas al enviar una importación incluso si se pierde la respuesta', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); render(<App />);
    await screen.findByText('Dataset conectado'); await openPreview(user);
    await user.click(screen.getByRole('link', { name: 'Importar registros' }));
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['Timestamp,Event_ID\n'], 'TEST.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: 'Importar registros' }));
    await screen.findByRole('alert'); // Mock rejects the unconfigured import request: result is uncertain.
    await user.click(screen.getByRole('link', { name: 'Resumen' }));
    await screen.findByText('Dataset conectado');
    expect(metric('Alertas preliminares').getByText('—')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(call => call[0] === '/api/dashboard/summary')).toHaveLength(2);
    expect(fetch.mock.calls.filter(call => call[0] === '/api/detections/preview')).toHaveLength(1);
  });

  it('pierde la vista previa al reiniciar la sesión React sin guardarla ni ejecutar otra', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/incidentes';
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 2 alertas · 0 relaciones'); first.unmount();
    window.history.replaceState(null, '', '/'); render(<App />);
    await screen.findByText('Dataset conectado');
    expect(metric('Alertas preliminares').getByText('—')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(call => call[0] === '/api/detections/preview')).toHaveLength(1);
  });
});
