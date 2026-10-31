/** Shared JSON transport. Schema validation remains in each API service. */
export class ApiError extends Error {
  constructor(message: string, public readonly details: unknown = {}) { super(message); }
}

export async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (failure) {
    if (failure instanceof TypeError && !init.signal?.aborted) {
      throw new ApiError('No se pudo conectar con la API local. Comprueba que Vite y el backend sigan ejecutándose.');
    }
    throw failure;
  }
  const path = url.split('?')[0];
  const location = `${path} (HTTP ${response.status})`;
  if (response.redirected) throw new ApiError(`La API redirigió ${location}. Comprueba la URL y el proxy local.`, { status: response.status });
  const type = response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase();
  const jsonType = type === 'application/json' || Boolean(type?.startsWith('application/') && type.endsWith('+json'));
  let body: unknown;
  try {
    if (response.headers && !jsonType) throw new Error('Unexpected media type');
    body = await response.json();
  } catch (failure) {
    if (init.signal?.aborted) throw failure;
    const format = type === 'text/html' ? 'HTML' : 'una respuesta vacía o de formato no JSON';
    throw new ApiError(`La API devolvió ${format} en ${location}. Comprueba el backend y reinicia Vite con la configuración actualizada.`, { status: response.status });
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'El servicio no pudo completar la petición.';
    throw new ApiError(`HTTP ${response.status}: ${message}`, body);
  }
  return body;
}
