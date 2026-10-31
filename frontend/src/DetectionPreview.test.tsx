import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from './pages/IncidentsPage';
import { isDetectionPreview } from './services/detections';
import fixtures from './test/fixtures/detection-preview.json';

function mockPreview(body: unknown = fixtures.strict) {
  const mock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Vista previa SOC sin persistencia', () => {
  it('acepta contratos generados por el backend y rechaza evidencia o contadores incoherentes', () => {
    expect(isDetectionPreview(fixtures.strict)).toBe(true);
    expect(isDetectionPreview(fixtures.relative)).toBe(true);
    expect(isDetectionPreview(fixtures.empty)).toBe(true);
    expect(isDetectionPreview({ ...fixtures.strict, evidence: [] })).toBe(false);
    expect(isDetectionPreview({ ...fixtures.strict, counts: { ...fixtures.strict.counts, by_risk: { critical: 9, high: 0, medium: 0, low: 0 } } })).toBe(false);
    expect(isDetectionPreview({ ...fixtures.strict, read_only: false })).toBe(false);
  });

  it('no ejecuta análisis al abrir, cambiar la hipótesis o usar filtros', async () => {
    const fetch = mockPreview();
    const user = userEvent.setup();
    render(<IncidentsPage />);
    expect(fetch).not.toHaveBeenCalled();
    const checkbox = screen.getByRole('checkbox', { name: /Hipótesis del analista/ });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar investigaciones' }), 'TEST');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Sin vista previa ejecutada')).toBeInTheDocument();
  });

  it('envía solo el clic explícito y muestra evidencia original, riesgo y validación pendiente', async () => {
    const fetch = mockPreview();
    const user = userEvent.setup();
    const { container } = render(<IncidentsPage />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 2 alertas · 0 relaciones');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/detections/preview');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ assume_comparable_clocks: false });
    expect(screen.getByText('TEST-PS-1')).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel', { name: 'Evidencias' })).getByText('Prioridad Alta · 82/100')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de validación')).toBeInTheDocument();
    expect(screen.getByText(/Prioridad heurística fija de la regla/)).toBeInTheDocument();
    expect(screen.getByText(/Severity original: Informational/)).toBeInTheDocument();
    expect(container.querySelector('.soc-evidence img')).toBeNull();
    expect(screen.getByText(/powershell.exe -EncodedCommand <img/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Correlación' }));
    expect(screen.getByText(/Correlación temporal omitida/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Notas' }));
    expect(screen.getByRole('textbox', { name: 'Notas del analista' })).toBeDisabled();
  });

  it('filtra por riesgo, regla y Log_ID sin ejecutar ni guardar otro análisis', async () => {
    const fetch = mockPreview();
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 2 alertas · 0 relaciones');
    await user.selectOptions(screen.getByLabelText('Filtrar investigaciones por riesgo'), 'low');
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filtrar investigaciones por riesgo'), 'high');
    await user.selectOptions(screen.getByLabelText('Filtrar por tipo de amenaza'), 'EXEC-001');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar investigaciones' }), 'TEST-PS-2');
    const buttons = screen.getAllByRole('button', { name: /Investigar alerta/ });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(screen.getByText('TEST-PS-2')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('la hipótesis es explícita, marca alertas y relaciones dependientes y no confirma casos', async () => {
    const fetch = mockPreview(fixtures.relative);
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(screen.getByRole('checkbox', { name: /Hipótesis del analista/ }));
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 4 alertas · 6 relaciones');
    expect(JSON.parse(fetch.mock.calls[0][1].body).assume_comparable_clocks).toBe(true);
    expect(screen.getByText('Esta alerta depende de la hipótesis de relojes comparables.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Correlación' }));
    expect(screen.getAllByText('Relación bajo hipótesis de relojes comparables').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('checkbox', { name: /Hipótesis del analista/ }));
    expect(screen.getByText('Sin vista previa ejecutada')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('muestra resultados vacíos con su cobertura sin afirmar que no hay amenazas', async () => {
    mockPreview(fixtures.empty);
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('0 eventos · 0 alertas · 0 relaciones');
    expect(screen.getByText('Sin alertas en la cobertura evaluada')).toBeInTheDocument();
    expect(screen.getByText(/este resultado no descarta actividad fuera de cobertura/)).toBeInTheDocument();
  });

  it('informa respuestas incompatibles y desconexión sin una pantalla vacía', async () => {
    const fetch = mockPreview({ alerts: [] });
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('formato incompatible');
    expect(screen.getByRole('heading', { name: 'Investigaciones', level: 1 })).toBeInTheDocument();
    fetch.mockRejectedValueOnce(new Error('TEST sin conexión'));
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('TEST sin conexión');
  });

  it('bloquea envíos repetidos durante el procesamiento y permite abrir la evidencia completa', async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    expect(screen.getByRole('button', { name: 'Procesando vista previa…' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await act(async () => resolve({ ok: true, json: async () => fixtures.strict }));
    const event = fixtures.strict.evidence[0];
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...event, occurrences: [] }) });
    await user.click(screen.getByRole('button', { name: 'Ver evidencia TEST-PS-1' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Log_ID: TEST-PS-1')).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toBe(`/api/events/${event.id}`);
    expect(fetch.mock.calls.some(call => String(call[0]).includes('/api/incidents/'))).toBe(false);
  });
});
