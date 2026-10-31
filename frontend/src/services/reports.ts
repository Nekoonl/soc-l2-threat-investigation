import { ApiError } from './events';

export type ReportKind = 'technical' | 'executive';
export interface ReportScope { dataset_revision: string; preview_id?: string; }
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** No client findings are sent; the server resolves executed previews from its own memory. */
export async function fetchReport(kind: ReportKind, scope: ReportScope, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/reports/${kind}.pdf`, { method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope) });
  if (!response.ok) {
    let message = `No se pudo generar el informe (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') message = body.error;
    } catch { /* Keep the readable HTTP error if the service did not return JSON. */ }
    throw new ApiError(message);
  }
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf'
    || response.headers.get('x-soc-dataset-revision') !== scope.dataset_revision
    || (response.headers.get('x-soc-preview-id') || '') !== (scope.preview_id || '')) {
    throw new ApiError('El servicio devolvió un archivo o alcance incompatible. No se inició la descarga.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const start = new TextDecoder().decode(bytes.slice(0, 8));
  const end = new TextDecoder().decode(bytes.slice(-64)).trimEnd();
  const trailer = new TextDecoder().decode(bytes.slice(-2048));
  const xref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(trailer);
  const offset = xref ? Number(xref[1]) : -1;
  const validXref = offset > 0 && offset < bytes.length && new TextDecoder().decode(bytes.slice(offset, offset + 4)) === 'xref';
  if (bytes.length < 2000 || bytes.length > MAX_PDF_BYTES || !start.startsWith('%PDF-') || !end.endsWith('%%EOF') || !validXref) {
    throw new ApiError('El PDF está vacío, incompleto o supera 20 MB. No se inició la descarga.');
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

export function startPdfDownload(blob: Blob, kind: ReportKind) {
  const url = URL.createObjectURL(blob);
  const revoke = URL.revokeObjectURL.bind(URL);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SOC-L2-informe-${kind === 'technical' ? 'tecnico' : 'ejecutivo'}.pdf`;
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    window.setTimeout(() => revoke(url), 1000);
  }
}
