import { ApiError, requestJson } from './http';
export { ApiError, requestJson } from './http';

export interface ImportErrorRow { row: number; error: string; log_id?: string; }
export interface ImportResult {
  id: number;
  filename: string;
  sha256: string;
  accepted: number;
  duplicates: number;
  rejected: number;
  total_rows: number;
  errors: ImportErrorRow[];
  error_count: number;
  mapping: Record<string, string>;
  source_timezone: string | null;
  sheet_name: string | null;
  analysis_ran: boolean;
  unknown_timezone: number;
  unmapped_columns: string[];
}

export interface EventRecord {
  id: number;
  import_id: number;
  filename: string;
  file_sha256: string;
  synthetic: boolean;
  timestamp: string;
  timestamp_original?: string;
  timestamp_utc?: string | null;
  timezone_status?: 'known' | 'unknown' | 'unverified';
  source_timezone?: string | null;
  log_id?: string;
  src_ip: string;
  dst_ip: string;
  destination?: string;
  username: string;
  hostname: string;
  event_id: string;
  event_type: string;
  status: string;
  log_source?: string;
  source_severity?: string;
  event_description?: string;
  process_commandline?: string;
  message: string;
  raw: Record<string, string>;
  row_number: number;
  sheet_name?: string | null;
  source_fields?: Record<string, 'present' | 'empty' | 'missing'>;
  source_columns?: Record<string, string>;
  source_values?: Record<string, string>;
  stored_normalized?: Record<string, unknown>;
  provenance?: {
    legacy_normalization: boolean;
    original_file_stored: boolean;
    import_created_at: string | null;
    declared_timezone: string | null;
  };
}
export interface EventOccurrence {
  id: number;
  import_id: number;
  row_number: number;
  sheet_name: string | null;
  source_log_id: string;
  filename: string;
  sha256: string;
  created_at: string;
  raw: Record<string, string>;
}
export interface EventDetail extends EventRecord { occurrences: EventOccurrence[]; }
export interface EventPage {
  events: EventRecord[];
  total: number;
  dataset_total: number;
  page: number;
  page_size: number;
  pages: number;
}
export interface ImportSummary {
  id: number; filename: string; created_at: string; accepted: number; duplicates: number; rejected: number;
}
export interface EventOptions {
  log_source: string[]; hostname: string[]; status: string[]; source_severity: string[]; imports: ImportSummary[];
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isId = (value: unknown): value is number => isCount(value) && value > 0;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isStringMap = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every(item => typeof item === 'string');
const hasStrings = (value: JsonObject, fields: string[]) => fields.every(field => typeof value[field] === 'string');
const hasCounts = (value: JsonObject, fields: string[]) => fields.every(field => isCount(value[field]));
const isNullableString = (value: unknown) => value === null || typeof value === 'string';

export function isEventRecord(value: unknown): value is EventRecord {
  if (!isObject(value)) return false;
  const optionalStrings = ['timestamp_original', 'log_id', 'destination', 'log_source', 'source_severity', 'event_description', 'process_commandline'];
  return isId(value.id) && isId(value.import_id) && isId(value.row_number)
    && hasStrings(value, ['filename', 'file_sha256', 'timestamp', 'src_ip', 'dst_ip', 'username', 'hostname', 'event_id', 'event_type', 'status', 'message'])
    && typeof value.synthetic === 'boolean' && isStringMap(value.raw)
    && optionalStrings.every(field => value[field] === undefined || typeof value[field] === 'string')
    && ['timestamp_utc', 'source_timezone', 'sheet_name'].every(field => value[field] === undefined || isNullableString(value[field]))
    && (value.timezone_status === undefined || value.timezone_status === 'known' || value.timezone_status === 'unknown' || value.timezone_status === 'unverified')
    && ['source_columns', 'source_values'].every(field => value[field] === undefined || isStringMap(value[field]))
    && (value.source_fields === undefined || (isObject(value.source_fields) && Object.values(value.source_fields).every(state => ['present', 'empty', 'missing'].includes(String(state)))))
    && (value.stored_normalized === undefined || isObject(value.stored_normalized))
    && (value.provenance === undefined || (isObject(value.provenance)
      && typeof value.provenance.legacy_normalization === 'boolean' && typeof value.provenance.original_file_stored === 'boolean'
      && isNullableString(value.provenance.import_created_at) && isNullableString(value.provenance.declared_timezone)));
}

function isEventPage(value: unknown): value is EventPage {
  return isObject(value) && Array.isArray(value.events) && value.events.every(isEventRecord)
    && hasCounts(value, ['total', 'dataset_total', 'pages']) && isId(value.page) && isId(value.page_size);
}

function isEventOptions(value: unknown): value is EventOptions {
  return isObject(value) && ['log_source', 'hostname', 'status', 'source_severity'].every(field => isStrings(value[field]))
    && Array.isArray(value.imports) && value.imports.every(item => isObject(item) && isId(item.id)
      && hasStrings(item, ['filename', 'created_at']) && hasCounts(item, ['accepted', 'duplicates', 'rejected']));
}

export function isImportResult(value: unknown): value is ImportResult {
  return isObject(value) && isId(value.id) && hasStrings(value, ['filename', 'sha256'])
    && hasCounts(value, ['accepted', 'duplicates', 'rejected', 'total_rows', 'error_count', 'unknown_timezone'])
    && isStringMap(value.mapping) && isStrings(value.unmapped_columns)
    && isNullableString(value.source_timezone) && isNullableString(value.sheet_name) && typeof value.analysis_ran === 'boolean'
    && Array.isArray(value.errors) && value.errors.every(item => isObject(item) && isId(item.row)
      && typeof item.error === 'string' && (item.log_id === undefined || typeof item.log_id === 'string'));
}

function isEventDetail(value: unknown): value is EventDetail {
  return isEventRecord(value) && 'occurrences' in value && Array.isArray(value.occurrences)
    && value.occurrences.every(item => isObject(item) && isId(item.id) && isId(item.import_id) && isId(item.row_number)
      && hasStrings(item, ['source_log_id', 'filename', 'sha256', 'created_at']) && isNullableString(item.sheet_name) && isStringMap(item.raw));
}

const incompatibleBackend = 'El backend respondió con un formato anterior o incompleto. Reinicia el servidor Python actualizado y vuelve a consultar.';

/** Only called by the explicit import action, never by file selection. */
export async function uploadLogs(file: File, sourceTimezone: string, signal: AbortSignal): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (sourceTimezone) form.append('source_timezone', sourceTimezone);
  const result = await requestJson('/api/import', { method: 'POST', body: form, signal });
  if (!isImportResult(result)) throw new ApiError(`${incompatibleBackend} El archivo podría haberse guardado; revisa Eventos antes de repetir la carga.`);
  return result;
}

export async function getEvents(params: URLSearchParams, signal: AbortSignal): Promise<EventPage> {
  params.set('real_only', '1');
  const result = await requestJson(`/api/events?${params}`, { method: 'GET', cache: 'no-store', signal });
  if (!isEventPage(result)) throw new ApiError(incompatibleBackend);
  return result;
}

export async function getEventOptions(signal: AbortSignal): Promise<EventOptions> {
  const result = await requestJson('/api/events/options', { method: 'GET', cache: 'no-store', signal });
  if (!isEventOptions(result)) throw new ApiError(incompatibleBackend);
  return result;
}

export async function getEventDetail(id: number, signal: AbortSignal): Promise<EventDetail> {
  const result = await requestJson(`/api/events/${id}`, { method: 'GET', cache: 'no-store', signal });
  if (!isEventDetail(result)) throw new ApiError(incompatibleBackend);
  return result;
}
