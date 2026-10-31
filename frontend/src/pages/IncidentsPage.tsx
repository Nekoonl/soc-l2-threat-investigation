import { useEffect, useRef, useState } from 'react';
import { Search, FolderSearch, ShieldAlert, Play, LoaderCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Notice, PageHeader, PriorityBadge } from '../components/ui';
import { AlertInvestigation } from '../components/AlertInvestigation';
import { riskLabels, runDetectionPreview } from '../services/detections';
import type { DetectionPreview, Risk } from '../services/detections';
import '../detection.css';

export function IncidentsPage({ onPreviewCompleted, initialPreview = null }: { onPreviewCompleted?: (preview: DetectionPreview) => void; initialPreview?: DetectionPreview | null }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('');
  const [rule, setRule] = useState('');
  const [relative, setRelative] = useState(false);
  // Restore only a strict result; the relative-clock option always starts unchecked.
  const [preview, setPreview] = useState<DetectionPreview | null>(() => initialPreview?.options.assume_comparable_clocks ? null : initialPreview);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function executePreview() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setRunning(true); setError(''); setPreview(null); setSelected(null); setPage(1); setQuery(''); setSeverity(''); setRule('');
    try {
      const result = await runDetectionPreview(relative, controller.signal);
      if (!controller.signal.aborted) { setPreview(result); setSelected(result.alerts[0]?.id || null); onPreviewCompleted?.(result); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo ejecutar la vista previa.');
    } finally { if (!controller.signal.aborted) setRunning(false); }
  }

  const visible = (preview?.alerts || []).filter(alert => (!severity || alert.severity === severity) && (!rule || alert.rule_id === rule)
    && [alert.id, alert.title, alert.src_ip, alert.username, alert.hostname, ...alert.evidence_ids.map(id => preview?.evidence.find(event => event.id === id)?.log_id || '')].join(' ').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setPage(1); setSelected(null); }
  function selectRelated(id: string) {
    setQuery(''); setSeverity(''); setRule(''); setSelected(id);
    setPage(Math.floor((preview?.alerts.findIndex(alert => alert.id === id) || 0) / 20) + 1);
  }
  const selectedAlert = preview?.alerts.find(alert => alert.id === selected) || null;

  return <>
    <PageHeader eyebrow="ANÁLISIS DE EVIDENCIAS" title="Investigaciones" description="Revisa las alertas, sus reglas y los eventos que las sustentan." action={<Badge tone="blue">Alertas preliminares</Badge>} />
    <Notice><strong>Una alerta no confirma un incidente.</strong> Validación del analista pendiente. La vista previa no guarda ni modifica investigaciones.</Notice>
    <Card title="Vista previa SOC" description="Evalúa las cinco reglas sobre los registros disponibles." className="soc-preview-controls" action={<Button variant="primary" disabled={running} onClick={executePreview}>{running ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{running ? 'Procesando vista previa…' : 'Ejecutar vista previa'}</Button>}>
      <label className="soc-clock-option"><input type="checkbox" checked={relative} disabled={running} onChange={event => { setRelative(event.target.checked); setPreview(null); setSelected(null); setError(''); }} />Hipótesis del analista: los relojes del dataset son comparables</label>
      <p>Solo activa esta hipótesis con una justificación. Permite comparar horas originales sin zona; no demuestra sincronización ni establece una zona horaria. Sin ella, se omiten las ventanas que carecen de base temporal.</p>
      {running && <p role="status">Leyendo evidencias y evaluando reglas; los resultados permanecerán en memoria.</p>}
      {error && <div className="soc-preview-error" role="alert">{error}</div>}
    </Card>
    <div className="section-summary"><span>{preview ? `${preview.dataset.event_count} eventos · ${preview.counts.alerts} alertas · ${preview.counts.correlations} relaciones` : 'Sin vista previa ejecutada'}</span><Badge tone={preview?.options.assume_comparable_clocks ? 'amber' : 'neutral'}>{preview ? preview.options.assume_comparable_clocks ? 'Hipótesis de relojes comparables' : 'Sin hipótesis temporal' : 'Ejecución manual'}</Badge></div>
    {preview && <details className="soc-manifest"><summary>Reproducibilidad y alcance de la vista previa</summary><p>{preview.preview_id} · motor {preview.engine_version}</p><p className="evidence-hash">Huella del conjunto leído, distinta del hash del Excel: <code>{preview.dataset.sha256}</code></p><p>{preview.dataset.unknown_timezone_count} fechas sin zona · {preview.dataset.absolute_time_count} con base absoluta · {preview.dataset.unverified_time_count} no verificables. Casos guardados preservados: {preview.dataset.stored_incident_count}. Registros marcados sintéticos excluidos: {preview.dataset.excluded_synthetic_count}.</p>{preview.options.assumption && <p>{preview.options.assumption} Ámbito: {preview.options.relative_scope_count} eventos sin zona de esta ejecución.</p>}</details>}
    <div className="investigation-layout">
      <Card title="Alertas" action={<Badge>{preview ? `${visible.length} coincidencias` : 'Sin ejecutar'}</Badge>} className="investigation-list">
        <div className="investigation-filters"><label className="search-input"><Search size={16} aria-hidden="true" /><input type="search" maxLength={200} value={query} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="Buscar alerta, Log_ID o entidad…" aria-label="Buscar investigaciones" /></label>
          <select aria-label="Filtrar investigaciones por riesgo" value={severity} onChange={event => changeFilter(setSeverity, event.target.value)}><option value="">Todos los riesgos</option>{Object.entries(riskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Filtrar por tipo de amenaza" value={rule} onChange={event => changeFilter(setRule, event.target.value)}><option value="">Todas las reglas</option>{preview?.coverage.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        {visible.length ? <ul className="soc-alert-list">{visible.slice((page - 1) * 20, page * 20).map(alert => <li key={alert.id}><button className={`soc-alert-button ${selected === alert.id ? 'soc-alert-selected' : ''}`} aria-pressed={selected === alert.id} aria-label={`Investigar alerta ${alert.id}`} onClick={() => setSelected(alert.id)}><strong>{alert.title}</strong><span className="soc-alert-meta"><PriorityBadge level={alert.severity} score={alert.score} /><span>{alert.rule_id} · {alert.event_count} eventos</span></span><span>Evidencias: {alert.evidence_ids.slice(0, 3).map(id => preview?.evidence.find(event => event.id === id)?.log_id || `ID interno ${id}`).join(' · ')}{alert.event_count > 3 && ' · más evidencias en el detalle'}</span><small>{alert.id}</small><small>{alert.depends_on_clock_assumption ? 'Depende de hipótesis temporal' : alert.rule_id === 'EXEC-001' ? 'Indicador sin ventana temporal' : 'Base temporal absoluta'}</small></button></li>)}</ul>
          : <EmptyState icon={FolderSearch} title={preview ? preview.alerts.length ? 'Sin coincidencias' : 'Sin alertas en la cobertura evaluada' : 'Sin vista previa'} description={preview ? 'Revisa los filtros y las reglas omitidas; este resultado no descarta actividad fuera de cobertura.' : 'Pulsa Ejecutar vista previa para analizar los registros almacenados sin guardar resultados.'} />}
        {preview && <div className="table-pagination"><span>Página {page} de {pages}</span><div><Button aria-label="Alertas anteriores" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} aria-hidden="true" /></Button><Button aria-label="Alertas siguientes" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} aria-hidden="true" /></Button></div></div>}
        <div className="list-bottom-note"><ShieldAlert size={14} aria-hidden="true" />{preview ? (Object.keys(riskLabels) as Risk[]).map(risk => `${riskLabels[risk]}: ${preview.counts.by_risk[risk]}`).join(' · ') : 'Clasificación pendiente de evidencia'}</div>
      </Card>
      <AlertInvestigation key={preview?.preview_id || 'empty'} alert={selectedAlert} preview={preview} onSelectRelated={selectRelated} />
    </div>
    {preview && <Card title="Cobertura de las reglas" description="Los eventos sin contexto/campos requeridos no se cuentan como descartados por benignidad. Una regla omitida no significa cero amenazas." className="soc-coverage">
      <div className="table-scroll" role="region" aria-label="Cobertura de reglas SOC" tabIndex={0}><table className="event-records-table"><thead><tr>{['REGLA', 'EVALUADOS', 'SIN BASE TEMPORAL', 'SIN CONTEXTO / CAMPOS', 'ALERTAS'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{preview.coverage.map(item => <tr key={item.id}><td><strong>{item.id} · {item.name}</strong><small>{item.status === 'not_evaluated' ? 'No evaluada' : item.status === 'partial' ? 'Cobertura parcial' : 'Evaluada'} · {item.reason}</small><details><summary>Condición, campos y límites</summary><p>{item.condition}</p><p>{item.fields.join(' · ')}</p><p>{item.limitations}</p></details></td><td>{item.evaluated_events}</td><td>{item.omitted_temporal_events}</td><td>{item.omitted_context_events}</td><td>{item.alerts}</td></tr>)}</tbody></table></div>
    </Card>}
  </>;
}
