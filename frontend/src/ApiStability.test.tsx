import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiError, requestJson } from './services/http';
import { getBackendHealth } from './services/backend';
import fixtures from './test/fixtures/report-data.json';

const health = { status: 'ok', app: 'TEST', version: 'TEST', timezone: 'America/Panama' };
const init = () => ({ method: 'GET', signal: new AbortController().signal });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

describe('Estabilidad del transporte API local', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'Application/Problem+JSON'])('acepta JSON válido con Content-Type %s', async type => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(health), { headers: { 'Content-Type': type } })));
    expect(await getBackendHealth(init().signal)).toEqual(health);
  });

  it('distingue HTML HTTP 200 del JSON esperado e identifica la ruta sin exponer la búsqueda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html>TEST SPA</html>', { headers: { 'Content-Type': 'text/html' } })));
    await expect(requestJson('/api/events?search=TEST_PRIVATE_QUERY', init())).rejects.toThrow('/api/events (HTTP 200)');
    await expect(requestJson('/api/events?search=TEST_PRIVATE_QUERY', init())).rejects.not.toThrow('TEST_PRIVATE_QUERY');
  });

  it('conserva el código HTTP cuando el proxy devuelve un error vacío o no JSON', async () => {
    for (const body of ['', 'TEST upstream unavailable']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 500, headers: { 'Content-Type': 'text/plain' } })));
      await expect(requestJson('/api/health', init())).rejects.toThrow('HTTP 500');
    }
  });

  it('conserva la causa y los detalles de un error JSON del backend', async () => {
    const body = { error: 'TEST archivo rechazado', rejected: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body, 422)));
    const failure = await requestJson('/api/import', init()).catch(error => error);
    expect(failure).toBeInstanceOf(ApiError);
    if (!(failure instanceof ApiError)) throw new Error('Expected ApiError');
    expect(failure.message).toContain('HTTP 422: TEST archivo rechazado');
    expect(failure.details).toEqual(body);
  });

  it('rechaza JSON malformado aunque la cabecera anuncie JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{TEST_INVALID', { headers: { 'Content-Type': 'application/json' } })));
    await expect(requestJson('/api/dashboard/summary', init())).rejects.toThrow('formato no JSON');
  });

  it('identifica redirecciones en lugar de aceptar el documento final como API', async () => {
    const response = json(health); Object.defineProperty(response, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(getBackendHealth(init().signal)).rejects.toThrow('redirigió /api/health');
  });

  it('explica un fallo de red y conserva la cancelación explícita', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch);
    await expect(requestJson('/api/health', init())).rejects.toThrow('No se pudo conectar con la API local');
    const controller = new AbortController(); controller.abort();
    const aborted = new DOMException('TEST cancelado', 'AbortError'); fetch.mockRejectedValueOnce(aborted);
    await expect(requestJson('/api/health', { signal: controller.signal })).rejects.toBe(aborted);
  });

  it('muestra el error real en Configuración y recupera Disponible mediante reintento manual', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: 'TEST Uvicorn no disponible' }, 502)).mockImplementation(async () => json(health));
    vi.stubGlobal('fetch', fetch); window.location.hash = '#/configuracion';
    const user = userEvent.setup(); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 502: TEST Uvicorn no disponible');
    expect(screen.getByText('Backend sin conexión')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones de la plataforma' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Comprobar backend' }));
    await screen.findByText('Backend disponible');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch.mock.calls.every(call => call[0] === '/api/health')).toBe(true);
  });

  it('mantiene Dashboard y la navegación ante HTML y recupera las métricas con un reintento', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    let broken = true;
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/health') return json(health);
      if (url === '/api/dashboard/summary') return broken
        ? new Response('<html>TEST fallback</html>', { headers: { 'Content-Type': 'text/html' } }) : json(fixtures.summary);
      throw new Error('TEST unexpected request');
    });
    vi.stubGlobal('fetch', fetch); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTML');
    expect(screen.getByRole('heading', { level: 1, name: 'Visión general de seguridad' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones de la plataforma' })).getAllByRole('link')).toHaveLength(6);
    broken = false;
    await user.click(screen.getByRole('button', { name: /Actualizar resumen/ }));
    await screen.findByText('Dataset conectado');
    expect(within(screen.getByRole('region', { name: 'Eventos importados' })).getByText('8')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch.mock.calls.some(call => call[0] === '/api/detections/preview')).toBe(false);
  });
});
