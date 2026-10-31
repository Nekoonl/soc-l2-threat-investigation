import type { EventRecord } from '../services/events';

/** Never pass an unzoned timestamp through Date, which would invent a browser zone. */
export function eventTime(event: Pick<EventRecord, 'timestamp' | 'timestamp_utc' | 'timezone_status'> & Partial<Pick<EventRecord, 'raw' | 'provenance'>>) {
  if (event.timezone_status === 'unverified') return { value: event.timestamp.replace('T', ' '), zone: 'Zona de origen no verificable' };
  // Older records may contain a fabricated UTC normalization while raw kept an unzoned source.
  const original = event.raw?.Timestamp;
  if (original !== undefined && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(original.trim()) && !event.provenance?.declared_timezone) {
    return { value: original.trim() ? original.replace('T', ' ') : 'Vacío en el archivo', zone: 'Zona no indicada' };
  }
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(event.timestamp);
  if (event.timezone_status === 'unknown' || (!event.timestamp_utc && !hasOffset)) {
    return { value: event.timestamp ? event.timestamp.replace('T', ' ') : 'No indicado en origen', zone: 'Zona no indicada' };
  }
  const value = event.timestamp_utc || event.timestamp;
  const parsed = new Date(value);
  return { value: Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace('T', ' ').replace(/Z$/, ''), zone: 'UTC' };
}
