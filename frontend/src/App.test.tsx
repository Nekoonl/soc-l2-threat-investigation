import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import dashboardFixture from './test/fixtures/dashboard-data.json';

function mockHealth() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => {
    if (url === '/api/events/options') return { log_source: [], hostname: [], status: [], source_severity: [], imports: [] };
    if (url === '/api/dashboard/summary') return dashboardFixture.empty;
    if (url.startsWith('/api/events?')) return { events: [], total: 0, dataset_total: 0, page: 1, page_size: 25, pages: 0 };
    return { status: 'ok', app: 'SOC L2', version: 'test', timezone: 'America/Panama' };
  } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { mockHealth(); });

describe('Navegación y límites de la etapa visual', () => {
  it('permite recorrer las seis pantallas y señala la sección activa', async () => {
    const user = userEvent.setup();
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Secciones de la plataforma' });
    for (const [label, heading] of [['Eventos', 'Eventos'], ['Investigaciones', 'Investigaciones'], ['Importar registros', 'Importar registros'], ['Informes', 'Informes'], ['Configuración', 'Configuración'], ['Resumen', 'Visión general de seguridad']]) {
      const link = within(nav).getByRole('link', { name: label });
      await user.click(link);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(link).toHaveAttribute('aria-current', 'page');
    }
  });

  it('consulta el resumen real y el estado sin ejecutar el motor SOC', async () => {
    const fetchMock = mockHealth();
    render(<App />);
    await screen.findByText('Backend disponible');
    await screen.findByText('Sin eventos importados');
    expect(screen.getAllByLabelText('Dato no disponible')).toHaveLength(1);
    expect(screen.getByText('Vista previa SOC pendiente')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(call => ['/api/health', '/api/dashboard/summary'].includes(call[0]))).toBe(true);
    expect(screen.queryByText(/Cargar demo/i)).not.toBeInTheDocument();
  });

  it('selecciona y quita un archivo sin enviarlo antes del clic explícito', async () => {
    const fetchMock = mockHealth();
    window.location.hash = '#/importacion';
    const user = userEvent.setup();
    render(<App />);
    const file = new File(['timestamp,event_id\n'], 'evidencia.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Seleccionar archivo'), file);
    expect(screen.getByText('evidencia.csv')).toBeInTheDocument();
    expect(screen.getByText(/Seleccionado localmente, sin enviar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar registros' })).toBeEnabled();
    expect(fetchMock.mock.calls.every(call => call[0] === '/api/health')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Quitar archivo' }));
    expect(screen.queryByText('evidencia.csv')).not.toBeInTheDocument();
  });

  it('rechaza una extensión incompatible con un mensaje explícito', async () => {
    window.location.hash = '#/importacion';
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await user.upload(screen.getByLabelText('Seleccionar archivo'), new File(['no es un log'], 'archivo.exe'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona un archivo CSV o Excel');
    expect(screen.getByRole('button', { name: 'Importar registros' })).toBeDisabled();
  });

  it('permite explorar las pestañas de evidencia con el teclado', async () => {
    window.location.hash = '#/incidentes';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Evidencias' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Correlación' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Correlación' })).toHaveTextContent('Las relaciones necesitan contexto');
    await user.keyboard('{End}');
    expect(screen.getByRole('textbox', { name: 'Notas del analista' })).toBeDisabled();
  });

  it('informa la desconexión del backend sin bloquear la interfaz', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sin conexión')));
    window.location.hash = '#/configuracion';
    render(<App />);
    expect(await screen.findByText('Backend sin conexión')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuración', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('No se pudo comprobar el backend.')).toBeInTheDocument();
  });

  it('mantiene deshabilitada la generación de informes sin eventos', async () => {
    window.location.hash = '#/informes';
    render(<App />);
    await screen.findByText(/No hay eventos importados suficientes/);
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generar informe ejecutivo' })).toBeDisabled();
  });

  it('el enlace para saltar al contenido no altera la ruta', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('link', { name: 'Saltar al contenido' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Visión general de seguridad', level: 1 })).toBeInTheDocument();
  });

  it('trata una ruta desconocida sin mostrar datos ni una pantalla equivocada', () => {
    window.location.hash = '#/desconocido';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al resumen' })).toHaveAttribute('href', '#/dashboard');
  });
});
