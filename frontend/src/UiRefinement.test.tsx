import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ReportsPage } from './pages/ReportsPage';
import fixtures from './test/fixtures/report-data.json';
import type { DashboardSummary } from './services/dashboard';

const labels = ['Resumen', 'Eventos', 'Investigaciones', 'Importar registros', 'Informes', 'Configuración'];
const paths = ['dashboard', 'eventos', 'incidentes', 'importacion', 'informes', 'configuracion'];
const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
function mockApi() {
  const fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/health') return json({ status: 'ok', app: 'TEST', version: 'TEST', timezone: 'America/Panama' });
    if (url === '/api/dashboard/summary') return json(fixtures.empty);
    if (url === '/api/events/options') return json({ log_source: [], hostname: [], status: [], source_severity: [], imports: [] });
    if (url.startsWith('/api/events?')) return json({ events: fixtures.preview.evidence, total: 2, dataset_total: 2, page: 1, page_size: 25, pages: 1 });
    throw new Error('TEST unexpected request');
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Refinamiento accesible de las seis pantallas', () => {
  it('conserva orden, nombres y rutas y elimina decoración de desarrollo', async () => {
    mockApi(); window.location.hash = '#/configuracion'; render(<App />);
    await screen.findByText('Backend disponible');
    const nav = screen.getByRole('navigation', { name: 'Secciones de la plataforma' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual(labels);
    expect(links.map(link => link.getAttribute('href'))).toEqual(paths.map(path => `#/${path}`));
    expect(links[5]).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('EN DESARROLLO')).toBeNull();
    expect(screen.queryByText('Espacio de trabajo')).toBeNull();
    expect(screen.queryByText(/Etapa 2/)).toBeNull();
    expect(screen.getByRole('link', { name: 'SOC L2, resumen' })).toBeInTheDocument();
  });

  it('contrae y expande con teclado conservando nombres, ruta activa y estado al navegar', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/configuracion'; render(<App />);
    await screen.findByText('Backend disponible');
    const toggle = screen.getByRole('button', { name: 'Contraer menú lateral' });
    expect(toggle).toHaveAttribute('aria-controls', 'desktop-navigation');
    toggle.focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toHaveAttribute('aria-expanded', 'false');
    const nav = screen.getByRole('navigation', { name: 'Secciones de la plataforma' });
    await user.click(within(nav).getByRole('link', { name: 'Investigaciones' }));
    expect(window.location.hash).toBe('#/incidentes');
    expect(within(nav).getByRole('link', { name: 'Investigaciones' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('checkbox', { name: /Hipótesis del analista/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Expandir menú lateral' }));
    expect(screen.getByRole('button', { name: 'Contraer menú lateral' })).toHaveAttribute('aria-expanded', 'true');
    expect(fetch.mock.calls.every(call => call[0] === '/api/health')).toBe(true);
  });

  it('abre el diálogo móvil, navega por las rutas actuales y permite cerrarlo con cancelación', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/configuracion'; render(<App />);
    await screen.findByText('Backend disponible');
    const trigger = screen.getByRole('button', { name: 'Abrir navegación' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Menú de navegación' });
    expect(within(dialog).getAllByRole('link')).toHaveLength(7); // Brand plus the six sections.
    await user.click(within(dialog).getByRole('link', { name: 'Importar registros' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(window.location.hash).toBe('#/importacion');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.click(trigger); fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch.mock.calls.every(call => call[0] === '/api/health')).toBe(true);
  });

  it('cierra el diálogo móvil al cruzar el breakpoint de escritorio', async () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    mockApi(); window.location.hash = '#/configuracion'; const user = userEvent.setup(); const view = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Abrir navegación' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => { media.matches = true; media.addEventListener.mock.calls[0][1](); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir navegación' })).toHaveAttribute('aria-expanded', 'false');
    view.unmount(); expect(media.removeEventListener).toHaveBeenCalled();
  });

  it('hace enfocable la tabla extensa sin perder columnas, valores ni filtros', async () => {
    const fetch = mockApi(); window.location.hash = '#/eventos'; render(<App />);
    const region = await screen.findByRole('region', { name: 'Tabla de eventos' });
    await within(region).findByText(fixtures.preview.evidence[0].log_id);
    expect(region).toHaveAttribute('tabindex', '0');
    region.focus(); expect(region).toHaveFocus();
    expect(within(region).getAllByRole('columnheader')).toHaveLength(8);
    expect(screen.getByRole('searchbox', { name: 'Buscar eventos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filtrar por severidad de origen')).toBeInTheDocument();
    expect(within(region).getAllByText('Zona no indicada').length).toBeGreaterThan(0);
    expect(fetch.mock.calls.some(call => String(call[0]).includes('/detections/'))).toBe(false);
  });

  it('mantiene advertencias y acciones de PDF a la vista y deja metodología en ayuda desplegable', async () => {
    const loadSummary = vi.fn().mockResolvedValue(undefined); const user = userEvent.setup();
    render(<ReportsPage summary={{ data: fixtures.summary as DashboardSummary, loading: false, error: '' }} preview={null} loadSummary={loadSummary} />);
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Generar informe ejecutivo' })).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/Detecciones no evaluadas en el informe/)).toBeVisible();
    expect(screen.getByText(/Las alertas son preliminares/)).toBeVisible();
    const help = screen.getByText('Alcance y validez de los informes');
    expect(help.closest('details')).not.toHaveAttribute('open');
    await user.click(help); expect(help.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/Generar un PDF no ejecuta análisis/)).toBeVisible();
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });
});
