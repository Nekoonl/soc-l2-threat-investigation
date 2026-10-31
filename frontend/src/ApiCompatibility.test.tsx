import { StrictMode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const health = { status: 'ok', app: 'SOC L2', version: '1.0.0', timezone: 'America/Panama' };
const options = { log_source: [], hostname: [], status: [], source_severity: [], imports: [] };
const page = { events: [], total: 0, dataset_total: 0, page: 1, page_size: 25, pages: 0 };
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });

function mockBackend(eventBody: unknown, optionBody: unknown = options) {
  const mock = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/health') return json(health);
    if (url === '/api/events/options') return json(optionBody);
    if (url.startsWith('/api/events?')) return json(eventBody);
    return json({ error: 'No encontrado' }, false);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Compatibilidad del backend durante el arranque', () => {
  it('conserva el menú y permite salir de Eventos cuando el backend devuelve el esquema anterior', async () => {
    // This is the response shape observed on the running server before restarting Python.
    mockBackend({ events: [], total: 0, page: 1, page_size: 50 });
    window.location.hash = '#/eventos';
    const user = userEvent.setup();
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole('button', { name: 'Reintentar consulta' });
    expect(screen.getByText('Consulta no disponible')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Secciones de la plataforma' });
    expect(within(nav).getAllByRole('link')).toHaveLength(6);
    await user.click(within(nav).getByRole('link', { name: 'Resumen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Visión general de seguridad' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Importar registros' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Importar registros' })).toBeInTheDocument();
  });

  it.each(['', '#/dashboard', '#/importacion'])('monta la ruta %s con StrictMode y sin esperar los datos de Eventos', async hash => {
    mockBackend({ events: [], total: 0, page: 1, page_size: 50 });
    window.location.hash = hash;
    render(<StrictMode><App /></StrictMode>);
    expect(screen.getByRole('heading', { level: 1, name: hash === '#/importacion' ? 'Importar registros' : 'Visión general de seguridad' })).toBeInTheDocument();
    await screen.findByText('Backend disponible');
  });

  it('rechaza listas de filtros incompletas sin impedir mostrar la pantalla de Eventos', async () => {
    mockBackend(page, { log_source: [], imports: [] });
    window.location.hash = '#/eventos';
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText(/Filtros no disponibles/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Eventos' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones de la plataforma' })).toBeInTheDocument();
  });

  it.each([true, false])('no convierte una respuesta antigua de importación en un resultado renderizable (HTTP exitoso: %s)', async ok => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/health') return json(health);
      return json({ id: 1, accepted: 0, duplicates: 0, rejected: 1, errors: [], error: 'Respuesta antigua de importación' }, ok);
    }));
    window.location.hash = '#/importacion';
    const user = userEvent.setup();
    render(<StrictMode><App /></StrictMode>);
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['TEST ONLY'], 'TEST-ONLY.csv'));
    await user.click(screen.getByRole('button', { name: 'Importar registros' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ok ? 'formato anterior o incompleto' : 'Respuesta antigua de importación');
    if (ok) expect(alert).toHaveTextContent('El archivo podría haberse guardado');
    expect(screen.queryByRole('region', { name: 'Resultado de la importación' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Importar registros' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones de la plataforma' })).toBeInTheDocument();
  });
});
