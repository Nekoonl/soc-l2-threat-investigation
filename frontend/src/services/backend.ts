import { requestJson } from './http';

export interface BackendHealth {
  status: 'ok';
  app: string;
  version: string;
  timezone: string;
}

/** Same-origin API request, using the same JSON checks as the data services. */
export async function getBackendHealth(signal: AbortSignal): Promise<BackendHealth> {
  const body = await requestJson('/api/health', { method: 'GET', cache: 'no-store', signal });
  if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'ok'
    || !('app' in body) || typeof body.app !== 'string'
    || !('version' in body) || typeof body.version !== 'string'
    || !('timezone' in body) || typeof body.timezone !== 'string') {
    throw new Error('El servicio no devolvió un estado compatible.');
  }
  return { status: 'ok', app: body.app, version: body.version, timezone: body.timezone };
}
