import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FolderSearch, FileSearch, GitBranch, NotebookPen, ArrowUpRight } from 'lucide-react';
import { Badge, Card, ContextHelp, EmptyState, PriorityBadge } from './ui';
import { DetectionEvidence } from './DetectionEvidence';
import { pageHref } from '../lib/navigation';
import type { DetectionPreview, PreviewAlert } from '../services/detections';

const tabs = [{ id: 'evidence', label: 'Evidencias', icon: FileSearch }, { id: 'correlation', label: 'Correlación', icon: GitBranch }, { id: 'notes', label: 'Notas', icon: NotebookPen }] as const;
type Tab = typeof tabs[number]['id'];
export function AlertInvestigation({ alert, preview, onSelectRelated }: { alert: PreviewAlert | null; preview: DetectionPreview | null; onSelectRelated: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('evidence');
  const tabList = useRef<HTMLDivElement>(null);
  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(tabs[next].id);
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  const rule = preview?.coverage.find(item => item.id === alert?.rule_id);
  const evidence = alert && preview ? alert.evidence_ids.map(id => preview.evidence.find(event => event.id === id)!) : [];
  return <Card className="investigation-detail">
    <div className="investigation-detail-heading"><span className="detail-file-icon"><FolderSearch size={20} aria-hidden="true" /></span><div><h2>{alert?.title || 'Espacio de investigación'}</h2><p>{alert ? `${alert.id} · ${alert.rule_id}` : 'Selecciona una alerta para revisar su contexto.'}</p></div></div>
    <div ref={tabList} className="detail-tabs" role="tablist" onKeyDown={handleTabKeys} aria-label="Detalle de la investigación">{tabs.map(item => <button type="button" id={`tab-${item.id}`} key={item.id} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} className={tab === item.id ? 'detail-tab detail-tab-active' : 'detail-tab'} onClick={() => setTab(item.id)}><item.icon size={15} aria-hidden="true" />{item.label}</button>)}</div>
    <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="detail-tab-panel">
      {tab === 'evidence' && (alert ? <div className="soc-investigation-body">
        <div className="soc-badges"><PriorityBadge level={alert.severity} score={alert.score} /><Badge>Pendiente de validación</Badge></div>
        <h3>Comportamiento observado</h3><p>{alert.explanation}</p>
        <h3>Justificación del riesgo</h3><p>{alert.risk_reason}</p>
        <p><strong>Base temporal:</strong> {alert.depends_on_clock_assumption ? 'Esta alerta depende de la hipótesis de relojes comparables.' : alert.rule_id === 'EXEC-001' ? 'Indicador individual; su detección no requiere ventana temporal.' : 'Offset o zona de origen documentada.'}</p>
        {alert.time_basis.assumption && <p>{alert.time_basis.assumption}</p>}
        <h3>Eventos originales ({alert.event_count})</h3><DetectionEvidence key={alert.id} events={evidence} />
        <h3>Limitaciones y explicaciones benignas</h3><p>{alert.limitations}{alert.rule_id === 'EXEC-001' && ' La codificación también puede formar parte de scripts administrativos autorizados.'}</p>
        <ContextHelp title="Regla e hipótesis de investigación"><p><strong>Condición de {alert.rule_id}:</strong> {rule?.condition}</p><p>{alert.hypothesis}</p><p>IP {alert.src_ip || 'no indicada'} · usuario {alert.username || 'no indicado'} · host {alert.hostname || 'no indicado'}. Consulta las identidades completas en los eventos vinculados.</p></ContextHelp>
      </div> : <EmptyState icon={FileSearch} title="Cada conclusión empieza con evidencia" description="Ejecuta una vista previa y selecciona una alerta para consultar sus eventos originales." />)}
      {tab === 'correlation' && (alert ? <div className="soc-investigation-body"><h3>Relaciones entre alertas</h3><p>Son vínculos de investigación por evidencia, IP o usuario y host en 30 minutos; no confirman un incidente.</p>
        {alert.related.length ? <ul className="soc-relations">{alert.related.map(link => <li key={link.id}><button className="text-link" onClick={() => onSelectRelated(link.id)}>{link.title} · {link.id}</button><p>{link.reasons.join(' · ')}</p>{link.depends_on_clock_assumption && <Badge tone="amber">Relación bajo hipótesis de relojes comparables</Badge>}</li>)}</ul> : <p>{alert.time_basis.kind === 'unavailable' ? 'Correlación temporal omitida: no hay una base temporal válida para esta evidencia.' : 'No se encontraron relaciones dentro de la cobertura y la política temporal seleccionadas.'}</p>}
      </div> : <EmptyState icon={GitBranch} title="Las relaciones necesitan contexto" description="Las relaciones requieren evidencia y una base temporal válida o una hipótesis explícita de comparabilidad." />)}
      {tab === 'notes' && <div className="notes-placeholder"><label htmlFor="investigation-notes">Notas del analista</label><textarea id="investigation-notes" disabled rows={7} placeholder="La vista previa no guarda ni modifica notas." /><p>Validación: pendiente. Las notas y la confirmación del caso requieren una etapa de persistencia autorizada.</p></div>}
    </div>
    <div className="investigation-detail-footer"><span>{alert ? 'Alerta en vista previa · sin guardar' : 'Sin caso seleccionado'}</span><a className="text-link" href={pageHref('eventos')}>Explorador de eventos<ArrowUpRight size={13} aria-hidden="true" /></a></div>
  </Card>;
}
