import { ApiError, isEventRecord, requestJson } from './events';
import type { EventRecord } from './events';

export type Risk = 'critical' | 'high' | 'medium' | 'low';
export const riskLabels: Record<Risk, string> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
export interface RelatedAlert { id: string; title: string; reasons: string[]; depends_on_clock_assumption: boolean; }
export interface PreviewAlert {
  id: string; rule_id: string; title: string; technique: string; tactic: string; score: number; severity: Risk;
  first_seen: string; last_seen: string; src_ip: string; username: string; hostname: string;
  explanation: string; limitations: string; evidence_ids: number[]; event_count: number;
  analyst_status: 'pending_review'; hypothesis: string; risk_reason: string; depends_on_clock_assumption: boolean;
  time_basis: { kind: 'absolute' | 'relative' | 'unavailable'; utc_verified: boolean; clock: string | null; assumption: string | null };
  related: RelatedAlert[];
}
export interface RuleCoverage {
  id: string; name: string; technique: string; tactic: string; score: number; condition: string; limitations: string;
  fields: string[]; temporal: boolean; evaluated_events: number; omitted_temporal_events: number;
  omitted_context_events: number; alerts: number; status: 'not_evaluated' | 'partial' | 'evaluated'; reason: string;
}
export interface DetectionPreview {
  schema_version: 1; preview_id: string; engine_version: string; read_only: true;
  dataset: { sha256: string; revision?: string; event_count: number; stored_incident_count: number; excluded_synthetic_count: number;
    unknown_timezone_count: number; absolute_time_count: number; unverified_time_count: number };
  options: { assume_comparable_clocks: boolean; relative_scope_count: number; assumption: string | null };
  counts: { alerts: number; correlations: number; by_risk: Record<Risk, number>; by_rule: Record<string, number> };
  coverage: RuleCoverage[]; alerts: PreviewAlert[]; evidence: EventRecord[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const strings = (v: Obj, keys: string[]) => keys.every(key => typeof v[key] === 'string');
const counts = (v: Obj, keys: string[]) => keys.every(key => count(v[key]));
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string');
const nullableText = (v: unknown) => v === null || typeof v === 'string';
function isAlert(value: unknown): value is PreviewAlert {
  if (!obj(value) || !obj(value.time_basis)) return false;
  const time = value.time_basis;
  return strings(value, ['id', 'rule_id', 'title', 'technique', 'tactic', 'first_seen', 'last_seen', 'src_ip', 'username', 'hostname', 'explanation', 'limitations', 'hypothesis', 'risk_reason'])
    && typeof value.severity === 'string' && Object.hasOwn(riskLabels, value.severity)
    && count(value.score) && value.score <= 100 && count(value.event_count)
    && value.analyst_status === 'pending_review' && typeof value.depends_on_clock_assumption === 'boolean'
    && Array.isArray(value.evidence_ids) && value.evidence_ids.every(id => count(id) && id > 0) && value.evidence_ids.length === value.event_count
    && ['absolute', 'relative', 'unavailable'].includes(String(time.kind)) && typeof time.utc_verified === 'boolean'
    && time.utc_verified === (time.kind === 'absolute') && nullableText(time.clock) && nullableText(time.assumption)
    && Array.isArray(value.related) && value.related.every(link => obj(link) && strings(link, ['id', 'title']) && texts(link.reasons) && typeof link.depends_on_clock_assumption === 'boolean');
}
function isCoverage(value: unknown): value is RuleCoverage {
  return obj(value) && strings(value, ['id', 'name', 'technique', 'tactic', 'condition', 'limitations', 'reason']) && count(value.score)
    && texts(value.fields) && typeof value.temporal === 'boolean' && counts(value, ['evaluated_events', 'omitted_temporal_events', 'omitted_context_events', 'alerts'])
    && ['not_evaluated', 'partial', 'evaluated'].includes(String(value.status));
}
export function isDetectionPreview(value: unknown): value is DetectionPreview {
  if (!obj(value) || value.schema_version !== 1 || value.read_only !== true || !strings(value, ['preview_id', 'engine_version'])
    || !obj(value.dataset) || !strings(value.dataset, ['sha256']) || (value.dataset.revision !== undefined && typeof value.dataset.revision !== 'string')
    || !counts(value.dataset, ['event_count', 'stored_incident_count', 'excluded_synthetic_count', 'unknown_timezone_count', 'absolute_time_count', 'unverified_time_count'])
    || !obj(value.options) || typeof value.options.assume_comparable_clocks !== 'boolean' || !count(value.options.relative_scope_count) || !nullableText(value.options.assumption)
    || !obj(value.counts) || !counts(value.counts, ['alerts', 'correlations']) || !obj(value.counts.by_risk) || !counts(value.counts.by_risk, Object.keys(riskLabels))
    || !obj(value.counts.by_rule) || !Object.values(value.counts.by_rule).every(count)
    || !Array.isArray(value.coverage) || !value.coverage.every(isCoverage)
    || !Array.isArray(value.alerts) || !value.alerts.every(isAlert)
    || !Array.isArray(value.evidence) || !value.evidence.every(isEventRecord)) return false;
  const evidenceIds = new Set(value.evidence.map(event => event.id));
  const alertIds = new Set(value.alerts.map(alert => alert.id));
  const ruleIds = new Set(value.coverage.map(rule => rule.id));
  return value.counts.alerts === value.alerts.length && alertIds.size === value.alerts.length && evidenceIds.size === value.evidence.length
    && ruleIds.size === value.coverage.length
    && Object.keys(riskLabels).every(risk => (value.counts as DetectionPreview['counts']).by_risk[risk as Risk] === (value.alerts as PreviewAlert[]).filter(alert => alert.severity === risk).length)
    && value.coverage.every(rule => (value.counts as DetectionPreview['counts']).by_rule[rule.id] === rule.alerts && rule.alerts === (value.alerts as PreviewAlert[]).filter(alert => alert.rule_id === rule.id).length)
    && value.alerts.every(alert => ruleIds.has(alert.rule_id) && alert.evidence_ids.every(id => evidenceIds.has(id)) && alert.related.every(link => alertIds.has(link.id))
      && (!alert.depends_on_clock_assumption || ((value.options as DetectionPreview['options']).assume_comparable_clocks && alert.time_basis.kind === 'relative')));
}

/** A POST is issued only after the analyst presses the preview button. */
export async function runDetectionPreview(assumeComparableClocks: boolean, signal: AbortSignal): Promise<DetectionPreview> {
  const result = await requestJson('/api/detections/preview', { method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assume_comparable_clocks: assumeComparableClocks }) });
  if (!isDetectionPreview(result)) throw new ApiError('La vista previa llegó incompleta o con un formato incompatible. Reinicia el backend actualizado y vuelve a ejecutar; no se guardó ningún resultado.');
  return result;
}
