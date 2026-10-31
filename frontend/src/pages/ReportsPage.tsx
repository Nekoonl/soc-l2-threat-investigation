import { useEffect, useRef, useState } from 'react';
import { FileText, BriefcaseBusiness, Download, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, ContextHelp, PageHeader } from '../components/ui';
import { fetchReport, startPdfDownload } from '../services/reports';
import type { ReportKind } from '../services/reports';
import type { DetectionPreview } from '../services/detections';
import type { SummaryState } from '../hooks/useWorkspaceData';
import '../reports.css';

interface Props { summary: SummaryState; preview: DetectionPreview | null; loadSummary: (force?: boolean) => Promise<void>; }
export function ReportsPage({ summary, preview, loadSummary }: Props) {
  const [includePreview, setIncludePreview] = useState(false);
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { void loadSummary(); return () => request.current?.abort(); }, [loadSummary]);
  const data = summary.data;
  const validPreview = data && preview?.dataset.revision === data.dataset_revision && preview.dataset.event_count === data.total_events ? preview : null;
  const canGenerate = Boolean(data && data.total_events > 0 && !summary.loading && !summary.error && (!includePreview || validPreview));

  async function generate(kind: ReportKind) {
    if (!canGenerate || !data || busy || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(kind); setError(''); setSuccess('');
    try {
      const blob = await fetchReport(kind, { dataset_revision: data.dataset_revision,
        ...(includePreview && validPreview ? { preview_id: validPreview.preview_id } : {}) }, controller.signal);
      if (!controller.signal.aborted) {
        startPdfDownload(blob, kind);
        setSuccess(`Informe ${kind === 'technical' ? 'técnico' : 'ejecutivo'} generado; descarga iniciada. El navegador gestiona dónde guardarlo.`);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo generar el informe.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return <>
    <PageHeader eyebrow="DOCUMENTACIÓN DE HALLAZGOS" title="Informes" description="Evidencia técnica y contexto ejecutivo para comunicar decisiones." action={<Badge tone="blue">PDF local · solo lectura</Badge>} />
    <Card title="Alcance del informe" description="Elige los resultados que incluirá el documento." className="report-scope" action={<Button disabled={summary.loading || Boolean(busy)} onClick={() => { setError(''); setSuccess(''); void loadSummary(true); }}><RefreshCw size={14} aria-hidden="true" />Actualizar alcance</Button>}>
      <p>{summary.loading ? 'Consultando el alcance…' : data ? `${data.total_events} registros · ${data.source_file_count} archivo(s) con eventos · ${data.hosts.unique_count} identidades de host` : 'Alcance no disponible.'}</p>
      <label><input type="checkbox" checked={includePreview} disabled={(!validPreview && !includePreview) || Boolean(busy)} onChange={event => { setIncludePreview(event.target.checked); setError(''); setSuccess(''); }} />Incluir la última vista previa SOC válida</label>
      {includePreview && !validPreview && <p role="alert">La vista seleccionada ya no coincide con el alcance. Ejecuta una nueva vista manual o desmarca su inclusión para generar un informe descriptivo.</p>}
      {includePreview && validPreview ? <p>{validPreview.counts.alerts} alertas preliminares de {validPreview.preview_id}. {validPreview.options.assume_comparable_clocks ? 'Esta vista utiliza la hipótesis explícita de relojes comparables; no demuestra sincronización ni establece zona horaria.' : 'Vista sin hipótesis de relojes comparables.'} Validación del analista: pendiente.</p>
        : <p>Detecciones no evaluadas en el informe.{validPreview ? ' Selecciona la vista ejecutada si deseas incluir sus resultados.' : ' Ejecuta una vista manual en Investigaciones para incluir alertas.'}</p>}
      <p>Las alertas son preliminares. Las fechas sin zona se identifican como «Zona no indicada».</p>
      {!summary.loading && !summary.error && data?.total_events === 0 && <p>No hay eventos importados suficientes para generar un PDF.</p>}
      {summary.error && <p role="alert">{summary.error}</p>}
    </Card>
    <div className="report-grid"><Card className="report-card"><div className="report-card-top"><span className="report-icon"><FileText size={26} strokeWidth={1.5} aria-hidden="true" /></span><Badge>PDF técnico</Badge></div><span className="report-audience">PARA EL EQUIPO DE SEGURIDAD</span><h2>Informe técnico</h2><p>Metodología, reglas, trazabilidad y evidencia original para preparar la investigación.</p><ul>{['Archivo, SHA-256 y eventos originales', 'Reglas, comandos y prioridad justificada', 'Limitaciones y recomendaciones técnicas'].map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul><div className="report-download"><Button disabled={!canGenerate || Boolean(busy)} variant="primary" onClick={() => void generate('technical')}>{busy === 'technical' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{busy === 'technical' ? 'Generando informe técnico…' : 'Generar informe técnico'}</Button><span>El PDF incluye solo el alcance seleccionado.</span></div></Card>
      <Card className="report-card"><div className="report-card-top"><span className="report-icon report-icon-teal"><BriefcaseBusiness size={26} strokeWidth={1.5} aria-hidden="true" /></span><Badge>PDF ejecutivo</Badge></div><span className="report-audience">PARA LA TOMA DE DECISIONES</span><h2>Informe ejecutivo</h2><p>Una síntesis comprensible de los registros, señales preliminares y prioridades de revisión.</p><ul>{['Alcance y severidades originales', 'Alertas preliminares seleccionadas', 'Recomendaciones y conclusión ejecutiva'].map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul><div className="report-download"><Button disabled={!canGenerate || Boolean(busy)} onClick={() => void generate('executive')}>{busy === 'executive' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{busy === 'executive' ? 'Generando informe ejecutivo…' : 'Generar informe ejecutivo'}</Button><span>Síntesis para una audiencia no técnica.</span></div></Card></div>
    {busy && <p className="report-generation-status" role="status">Preparando el PDF…</p>}
    {success && <p className="report-generation-success" role="status">{success}</p>}
    {error && <p className="report-generation-error" role="alert">{error}</p>}
    <ContextHelp title="Alcance y validez de los informes"><p>Se incluyen evidencias verificadas del dataset actual. Sin una vista seleccionada, las detecciones permanecen sin evaluar. Generar un PDF no ejecuta análisis ni confirma incidentes.</p><p>Una vista expirada o de otro dataset requiere una nueva ejecución manual. La severidad de origen y la prioridad SOC se presentan por separado; los casos heredados no se consideran confirmaciones.</p><p>La descarga se inicia solo al pulsar Generar. Los PDF no se archivan automáticamente en el servidor.</p></ContextHelp>
  </>;
}
