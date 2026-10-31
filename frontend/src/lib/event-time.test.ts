import { describe, expect, it } from 'vitest';
import { eventTime } from './event-time';
import { isLocalFrontendOrigin } from '../../dev/local-proxy';

describe('Fechas de evidencia y origen del proxy', () => {
  it('mantiene una fecha sin offset sin convertirla con la zona del navegador', () => {
    expect(eventTime({ timestamp: '2026-10-29T10:15:00', timezone_status: 'unknown', timestamp_utc: null })).toEqual({ value: '2026-10-29 10:15:00', zone: 'Zona no indicada' });
    expect(eventTime({ timestamp: '2026-10-29T10:15:00' }).zone).toBe('Zona no indicada');
  });
  it('presenta UTC únicamente cuando el offset es conocido', () => {
    expect(eventTime({ timestamp: '2026-10-29T10:15:00+02:00' })).toEqual({ value: '2026-10-29 08:15:00.000', zone: 'UTC' });
  });
  it('no atribuye la zona del timestamp normalizado heredado al valor original sin zona', () => {
    expect(eventTime({ timestamp: '2026-10-29T15:00:00+00:00', raw: { Timestamp: '2026-10-29 10:00:00' } })).toEqual({ value: '2026-10-29 10:00:00', zone: 'Zona no indicada' });
  });
  it('respeta una declaración temporal registrada explícitamente', () => {
    expect(eventTime({ timestamp: '2026-10-29T10:00:00+00:00', timestamp_utc: '2026-10-29T10:00:00+00:00', timezone_status: 'known',
      raw: { Timestamp: '2026-10-29 10:00:00' },
      provenance: { legacy_normalization: false, original_file_stored: true, import_created_at: null, declared_timezone: 'UTC' },
    })).toEqual({ value: '2026-10-29 10:00:00.000', zone: 'UTC' });
  });
  it('no llama UTC a una zona de origen que no puede verificarse', () => {
    expect(eventTime({ timestamp: '2026-10-29T15:00:00+00:00', timezone_status: 'unverified' }).zone).toBe('Zona de origen no verificable');
  });
  it('conserva el texto original sin zona y distingue una celda vacía', () => {
    const original = '2026-10-29 10:15:00.123456';
    expect(eventTime({ timestamp: '2026-10-29T15:15:00+00:00', raw: { Timestamp: original } })).toEqual({ value: original, zone: 'Zona no indicada' });
    expect(eventTime({ timestamp: '2026-10-29T15:00:00Z', raw: { Timestamp: '' } })).toEqual({ value: 'Vacío en el archivo', zone: 'Zona no indicada' });
  });
  it('normaliza el offset explícito sin depender de la zona del navegador', () => {
    expect(eventTime({ timestamp: '2026-10-29T10:15:00+02:30', raw: { Timestamp: '2026-10-29T10:15:00+02:30' }, timezone_status: 'known' })).toEqual({ value: '2026-10-29 07:45:00.000', zone: 'UTC' });
  });
  it('acepta solo el mismo origen de los puertos locales establecidos', () => {
    expect(isLocalFrontendOrigin('http://127.0.0.1:5173', '127.0.0.1:5173')).toBe(true);
    expect(isLocalFrontendOrigin('http://localhost:4173', 'localhost:4173')).toBe(true);
    for (const origin of ['https://foreign.invalid', 'null', 'http://127.0.0.1:9999', undefined]) {
      expect(isLocalFrontendOrigin(origin, '127.0.0.1:5173')).toBe(false);
    }
    expect(isLocalFrontendOrigin('http://localhost:5173', '127.0.0.1:5173')).toBe(false);
  });
});
