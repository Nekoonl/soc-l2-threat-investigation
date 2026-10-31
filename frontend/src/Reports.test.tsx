/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ReportsPage } from './pages/ReportsPage';
import { fetchReport, startPdfDownload } from './services/reports';
import fixtures from './test/fixtures/report-data.json';
import type { DashboardSummary } from './services/dashboard';
import type { DetectionPreview } from './services/detections';

const NativeURL = URL;
const basePdf = new Uint8Array(readFileSync(new NativeURL('./test/fixtures/report-executive-sample.pdf', import.meta.url)));
const technicalPdf = new Uint8Array(readFileSync(new NativeURL('./test/fixtures/report-technical-sample.pdf', import.meta.url)));
const create = vi.fn((_blob: Blob | MediaSource) => 'blob:TEST-PDF');
const revoke = vi.fn();
const clickedNames: string[] = [];
beforeEach(() => {
  create.mockClear(); revoke.mockClear(); clickedNames.length = 0;
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedNames.push(this.download); });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function pdfResponse(scope: { dataset_revision: string; preview_id?: string }, bytes = scope.preview_id ? technicalPdf : basePdf) {
  const headers: Record<string, string> = { 'content-type': 'application/pdf', 'x-soc-dataset-revision': scope.dataset_revision, 'x-soc-preview-id': scope.preview_id || '' };
  return { ok: true, status: 200, headers: { get: (name: string) => headers[name.toLowerCase()] || null }, arrayBuffer: async () => bytes.slice().buffer };
}
function mockApi(summary: unknown = fixtures.summary) {
  const mock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return json({ status: 'ok', app: 'TEST', version: 'TEST', timezone: 'America/Panama' });
    if (url === '/api/dashboard/summary') return json(summary);
    if (url === '/api/detections/preview') return json(fixtures.preview);
    if (url.startsWith('/api/reports/')) return pdfResponse(JSON.parse(String(init?.body)));
    throw new Error('TEST unexpected endpoint');
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
async function openReports(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: 'Informes' }));
  await screen.findByText(/8 registros/);
}

describe('Informes PDF explícitos y vinculados al servidor', () => {
  it('abrir Informes solo consulta el alcance; no genera PDF ni ejecuta detecciones', async () => {
    const fetch = mockApi(); window.location.hash = '#/informes'; render(<App />);
    await screen.findByText(/8 registros/);
    expect(screen.getByText(/Detecciones no evaluadas en el informe/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(fetch.mock.calls.every(call => ['/api/health', '/api/dashboard/summary'].includes(call[0]))).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('descarga el ejecutivo sin inventar análisis y comprueba MIME, alcance y bytes PDF', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/informes'; render(<App />);
    await screen.findByText(/8 registros/);
    await user.click(screen.getByRole('button', { name: 'Generar informe ejecutivo' }));
    expect(await screen.findByText(/Informe ejecutivo generado; descarga iniciada/)).toBeInTheDocument();
    expect(clickedNames).toEqual(['SOC-L2-informe-ejecutivo.pdf']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    const call = fetch.mock.calls.find(call => call[0] === '/api/reports/executive.pdf')!;
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ dataset_revision: fixtures.summary.dataset_revision });
    expect(fetch.mock.calls.some(call => call[0] === '/api/detections/preview')).toBe(false);
  });

  it('incluye alertas solo tras ejecutar la vista y seleccionarla; envía referencias, no hallazgos', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/incidentes'; render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ejecutar vista previa' }));
    await screen.findByText('8 eventos · 2 alertas · 0 relaciones'); await openReports(user);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/2 alertas preliminares/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generar informe técnico' }));
    await screen.findByText(/Informe técnico generado; descarga iniciada/);
    const call = fetch.mock.calls.find(call => call[0] === '/api/reports/technical.pdf')!;
    expect(JSON.parse(call[1].body)).toEqual({ dataset_revision: fixtures.summary.dataset_revision, preview_id: fixtures.preview.preview_id });
    expect(clickedNames).toEqual(['SOC-L2-informe-tecnico.pdf']);
    expect(fetch.mock.calls.filter(call => call[0] === '/api/detections/preview')).toHaveLength(1);
  });

  it('no descarga cuando el dataset está vacío', async () => {
    mockApi(fixtures.empty); window.location.hash = '#/informes'; render(<App />);
    await screen.findByText(/No hay eventos importados suficientes/);
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generar informe ejecutivo' })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('muestra el error de alcance y permite reintentarlo sin generar un PDF', async () => {
    const fetch = mockApi(); const user = userEvent.setup();
    fetch.mockImplementation(async (url: string) => {
      if (url === '/api/health') return json({ status: 'ok', app: 'TEST', version: 'TEST', timezone: 'America/Panama' });
      throw new Error('TEST alcance no disponible');
    });
    window.location.hash = '#/informes'; render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('TEST alcance no disponible');
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeDisabled();
    mockApi();
    await user.click(screen.getByRole('button', { name: 'Actualizar alcance' }));
    await screen.findByText(/8 registros/);
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza PDFs vacíos, truncados, xref incorrecta y revisiones ajenas sin iniciar descarga', async () => {
    const scope = { dataset_revision: fixtures.summary.dataset_revision };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const bytes of [new Uint8Array(), basePdf.slice(0, -100), new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(2500) + '\nstartxref\n100\n%%EOF')]) {
      fetch.mockResolvedValueOnce(pdfResponse(scope, bytes));
      await expect(fetchReport('executive', scope, new AbortController().signal)).rejects.toThrow('incompleto');
    }
    fetch.mockResolvedValueOnce(pdfResponse({ dataset_revision: 'f'.repeat(64) }));
    await expect(fetchReport('executive', scope, new AbortController().signal)).rejects.toThrow('alcance incompatible');
    const wrongMime = pdfResponse(scope);
    wrongMime.headers.get = () => 'text/html';
    fetch.mockResolvedValueOnce(wrongMime);
    await expect(fetchReport('executive', scope, new AbortController().signal)).rejects.toThrow('alcance incompatible');
    fetch.mockResolvedValueOnce(pdfResponse({ ...scope, preview_id: 'TEST-UNREQUESTED-PREVIEW' }));
    await expect(fetchReport('executive', scope, new AbortController().signal)).rejects.toThrow('alcance incompatible');
    expect(create).not.toHaveBeenCalled();
  });

  it('presenta expiración del servidor y errores de conexión sin generar ni recalcular', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/informes'; render(<App />);
    await screen.findByText(/8 registros/);
    fetch.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'TEST: vista previa expirada; ejecuta otra manualmente.' }) });
    await user.click(screen.getByRole('button', { name: 'Generar informe técnico' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('vista previa expirada');
    fetch.mockRejectedValueOnce(new Error('TEST sin conexión'));
    await user.click(screen.getByRole('button', { name: 'Generar informe ejecutivo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('TEST sin conexión');
    expect(create).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(call => call[0] === '/api/detections/preview')).toBe(false);
  });

  it('bloquea envíos duplicados durante la generación y aborta al salir', async () => {
    const fetch = mockApi(); const user = userEvent.setup(); window.location.hash = '#/informes'; const view = render(<App />);
    await screen.findByText(/8 registros/);
    let resolve!: (response: unknown) => void;
    fetch.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await user.click(screen.getByRole('button', { name: 'Generar informe técnico' }));
    expect(screen.getByRole('button', { name: 'Generando informe técnico…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generar informe ejecutivo' })).toBeDisabled();
    const signal = fetch.mock.calls[fetch.mock.calls.length - 1][1].signal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve(pdfResponse({ dataset_revision: fixtures.summary.dataset_revision })));
    expect(create).not.toHaveBeenCalled();
  });

  it('no omite silenciosamente una vista seleccionada si cambia el dataset', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const props = { summary: { data: fixtures.summary as DashboardSummary, loading: false, error: '' }, preview: fixtures.preview as DetectionPreview, loadSummary: load };
    const user = userEvent.setup(); const view = render(<ReportsPage {...props} />);
    await user.click(screen.getByRole('checkbox'));
    view.rerender(<ReportsPage {...props} summary={{ ...props.summary, data: { ...props.summary.data, dataset_revision: 'f'.repeat(64) } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ya no coincide');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Generar informe técnico' })).toBeEnabled();
  });

  it('libera la URL temporal del PDF después del clic de descarga', () => {
    vi.useFakeTimers();
    startPdfDownload(new Blob([basePdf], { type: 'application/pdf' }), 'executive');
    expect(clickedNames).toEqual(['SOC-L2-informe-ejecutivo.pdf']);
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:TEST-PDF');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
