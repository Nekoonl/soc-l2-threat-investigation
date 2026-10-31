import { ApiError, requestJson } from './events';

export interface DistributionItem { value: string | null; count: number; }
export interface EntitySummary { unique_count: number; missing_events: number; top: DistributionItem[]; other_events: number; }
export interface DashboardSummary {
  schema_version: 1; read_only: true; dataset_revision: string; total_events: number;
  excluded_synthetic_events: number; source_file_count: number; import_request_count: number;
  severity_original: DistributionItem[]; log_sources: DistributionItem[];
  hosts: EntitySummary; users: EntitySummary; source_ips: EntitySummary;
  authentication: { success: number; failure: number; unclassified: number };
  stored_case_count: number; confirmed_incidents: null;
}
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function items(v: unknown): v is DistributionItem[] {
  return Array.isArray(v) && v.every(item => object(item) && (item.value === null || typeof item.value === 'string') && count(item.count));
}
function entity(v: unknown): v is EntitySummary {
  return object(v) && count(v.unique_count) && count(v.missing_events) && count(v.other_events) && items(v.top)
    && v.top.every(item => typeof item.value === 'string') && v.top.length <= 10 && v.unique_count >= v.top.length;
}
const sum = (v: DistributionItem[]) => v.reduce((total, item) => total + item.count, 0);
export function isDashboardSummary(v: unknown): v is DashboardSummary {
  if (!object(v) || v.schema_version !== 1 || v.read_only !== true || v.confirmed_incidents !== null
    || typeof v.dataset_revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.dataset_revision)
    || !['total_events', 'excluded_synthetic_events', 'source_file_count', 'import_request_count', 'stored_case_count'].every(key => count(v[key]))
    || !items(v.severity_original) || !items(v.log_sources) || !entity(v.hosts) || !entity(v.users) || !entity(v.source_ips)
    || !object(v.authentication) || !['success', 'failure', 'unclassified'].every(key => count((v.authentication as Obj)[key]))) return false;
  const data = v as unknown as DashboardSummary;
  return sum(data.severity_original) === data.total_events && sum(data.log_sources) === data.total_events
    && [data.hosts, data.users, data.source_ips].every(group => sum(group.top) + group.other_events + group.missing_events === data.total_events)
    && data.authentication.success + data.authentication.failure + data.authentication.unclassified === data.total_events;
}
export async function getDashboardSummary(signal: AbortSignal): Promise<DashboardSummary> {
  const result = await requestJson('/api/dashboard/summary', { method: 'GET', cache: 'no-store', signal });
  if (!isDashboardSummary(result)) throw new ApiError('El resumen llegó incompleto o incoherente. Reinicia el backend actualizado y vuelve a consultar.');
  return result;
}
