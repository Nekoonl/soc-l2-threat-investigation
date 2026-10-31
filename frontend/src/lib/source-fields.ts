import type { EventRecord } from '../services/events';

const sourceColumns: Record<string, string> = {
  log_id: 'Log_ID', timestamp: 'Timestamp', hostname: 'Hostname', event_id: 'Event_ID', username: 'User',
  src_ip: 'Source_IP', destination: 'Destination', log_source: 'Log_Source', event_description: 'Event_Description',
  process_commandline: 'Process_CommandLine', status: 'Result', source_severity: 'Severity',
};

/** An empty source cell is different from an absent source column. */
export function sourceText(event: EventRecord, field: string, fallback = ''): string {
  const header = sourceColumns[field];
  const original = header && Object.hasOwn(event.raw, header) ? event.raw[header] : event.source_values?.[field];
  if (original !== undefined) return original.trim() ? original : 'Vacío en el archivo';
  if (event.source_fields?.[field] === 'empty') return 'Vacío en el archivo';
  const normalized = event[field as keyof EventRecord];
  const value = (typeof normalized === 'string' ? normalized : '') || fallback;
  return value || 'No indicado en origen';
}
