import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { UploadCloud, FileSpreadsheet, FileText, X, ShieldCheck, ArrowRight, Info, Database, Columns3, HardDrive, LoaderCircle } from 'lucide-react';
import { Badge, Button, Card, Notice, PageHeader } from '../components/ui';
import { ImportResultPanel } from '../components/ImportResultPanel';
import { formatBytes, validateFileSelection } from '../lib/file-selection';
import { ApiError, isImportResult, uploadLogs } from '../services/events';
import type { ImportResult } from '../services/events';

const officialColumns = ['Log_ID', 'Timestamp', 'Hostname', 'Event_ID', 'User', 'Source_IP', 'Destination', 'Log_Source', 'Event_Description', 'Process_CommandLine', 'Result', 'Severity'];

export function ImportPage({ onDatasetChanged }: { onDatasetChanged?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sourceTimezone, setSourceTimezone] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const step = result && (result.accepted || result.duplicates) ? 3 : file ? 2 : 1;

  useEffect(() => () => request.current?.abort(), []);

  function selectFile(files: FileList | null) {
    if (inFlight.current || !files?.length) return;
    setError('');
    setResult(null);
    setSubmitted(false);
    if (files.length !== 1) {
      setFile(null);
      setError('Selecciona un solo archivo por importación.');
      return;
    }
    const selected = files[0];
    const validationError = validateFileSelection(selected);
    if (validationError) {
      setFile(null);
      setError(validationError);
      if (input.current) input.current.value = '';
      return;
    }
    setFile(selected);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files);
  }

  function removeFile() {
    if (inFlight.current) return;
    setFile(null);
    setError('');
    setResult(null);
    setSubmitted(false);
    if (input.current) input.current.value = '';
  }

  async function importFile() {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current = controller;
    setProcessing(true);
    setSubmitted(true);
    setError('');
    setResult(null);
    try {
      // Invalidate before POST: a lost/aborted response may still mean committed data.
      onDatasetChanged?.();
      setResult(await uploadLogs(file, sourceTimezone, controller.signal));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError) {
        setError(failure.message);
        if (isImportResult(failure.details)) setResult(failure.details);
      } else {
        setError('No se pudo confirmar la importación. Comprueba la conexión y revisa Eventos antes de reintentar; el servidor podría haber guardado el archivo.');
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setProcessing(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="EVIDENCIAS DE ORIGEN" title="Importar registros"
        description="Añade tu archivo y conserva sus valores originales y procedencia."
        action={<Badge tone="blue">CSV / XLSX · carga manual</Badge>} />
      <ol className="import-progress" aria-label="Pasos de la importación">
        <li className={step === 1 ? 'import-progress-active' : ''} aria-current={step === 1 ? 'step' : undefined}><span>1</span><div><strong>Seleccionar archivo</strong><small>Excel o CSV local</small></div></li>
        <li className={step === 2 ? 'import-progress-active' : ''} aria-current={step === 2 ? 'step' : undefined}><span>2</span><div><strong>Validar y guardar</strong><small>Al pulsar Importar registros</small></div></li>
        <li className={step === 3 ? 'import-progress-active' : ''} aria-current={step === 3 ? 'step' : undefined}><span>3</span><div><strong>Explorar eventos</strong><small>Con evidencia de origen</small></div></li>
      </ol>
      <div className="import-layout">
        <div>
          <Card title="Archivo de evidencia" description="Selecciona un archivo desde tu equipo" action={<Badge tone="blue">CSV / XLSX</Badge>} className="file-import-card">
            <div className="import-card-body">
              <div className={`file-dropzone ${dragging ? 'file-dropzone-active' : ''}`}
                onDragOver={event => { event.preventDefault(); if (!processing) setDragging(true); }}
                onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
                onDrop={handleDrop}>
                <input ref={input} id="log-file" type="file" accept=".csv,.xlsx" className="sr-only"
                  disabled={processing} onChange={event => selectFile(event.target.files)} />
                <span className="upload-large-icon"><UploadCloud size={34} strokeWidth={1.4} aria-hidden="true" /></span>
                <h2>Arrastra tu archivo aquí</h2>
                <p>o selecciónalo desde tu computadora</p>
                <label htmlFor="log-file" className="button button-primary file-input-label">
                  <FileSpreadsheet size={15} aria-hidden="true" />Seleccionar archivo
                </label>
                <span className="file-limits">CSV o Excel (.xlsx)<span>·</span>Máximo 10 MB</span>
              </div>

              {file && (
                <div className="selected-file" role="status">
                  <span className="selected-file-icon">{file.name.toLowerCase().endsWith('.csv') ? <FileText size={23} aria-hidden="true" /> : <FileSpreadsheet size={23} aria-hidden="true" />}</span>
                  <div><strong>{file.name}</strong><p>{formatBytes(file.size)}<span>·</span>{submitted ? 'Solicitud de importación iniciada' : 'Seleccionado localmente, sin enviar'}</p></div>
                  <button className="icon-button" disabled={processing} onClick={removeFile} aria-label="Quitar archivo"><X size={17} aria-hidden="true" /></button>
                </div>
              )}

              <div className="import-timezone-controls">
                <label htmlFor="source-timezone">Zona horaria de fechas sin offset</label>
                <select id="source-timezone" value={sourceTimezone} disabled={processing} onChange={event => setSourceTimezone(event.target.value)}>
                  <option value="">No indicada: conservar hora sin zona</option>
                  <option value="UTC">UTC — declarada por el usuario</option>
                  <option value="America/Panama">America/Panama — declarada por el usuario</option>
                </select>
                <p>Elige una zona solo si está documentada. Los offsets escritos en el archivo se respetan. No se presupone Panamá.</p>
              </div>
              <div className="file-privacy"><ShieldCheck size={17} aria-hidden="true" /><p>El archivo se envía únicamente al pulsar Importar registros. Se conservan el original y su procedencia. Esta carga no ejecuta reglas SOC.</p></div>
              {processing && <div className="import-processing" role="status"><LoaderCircle size={17} className="spin" aria-hidden="true" />Enviando, validando y guardando el archivo…</div>}
              {error && <div className="form-error" role="alert"><Info size={16} aria-hidden="true" />{error}</div>}
            </div>
            <div className="import-actions">
              <span id="import-action-note"><Info size={14} aria-hidden="true" />Hasta 30.000 filas · Excel: primera hoja</span>
              <Button variant="primary" disabled={!file || processing} aria-describedby="import-action-note" onClick={() => void importFile()}>
                {processing ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
                {processing ? 'Importando…' : 'Importar registros'}
              </Button>
            </div>
          </Card>
          {result && <ImportResultPanel result={result} />}
          <Notice>La importación agrega registros; no sustituye datasets anteriores. Repetir un archivo registra duplicados y conserva también la procedencia de esa carga.</Notice>
        </div>

        <div className="import-guidance">
          <Card title="Prepara tus registros" className="guidance-card">
            <div className="guidance-body">
              <div className="guidance-item"><span><FileSpreadsheet size={18} aria-hidden="true" /></span><div><h3>Excel o CSV</h3><p>Una fila por evento y encabezados claros. Excel .xlsx sin fórmulas; CSV UTF-8 o Windows-1252.</p></div></div>
              <div className="guidance-item"><span><Columns3 size={18} aria-hidden="true" /></span><div><h3>Esquema oficial del Bootcamp</h3><p>Mapeo automático de identificadores, origen, descripción, comando, resultado y severidad.</p><details className="official-columns"><summary>Ver las 12 columnas previstas</summary><ul>{officialColumns.map(column => <li key={column}><code>{column}</code></li>)}</ul></details></div></div>
              <div className="guidance-item"><span><HardDrive size={18} aria-hidden="true" /></span><div><h3>Original y procedencia</h3><p>Se conserva el archivo en SQLite con SHA-256, Log_ID, hoja, fila y valores originales. Conserva también tu copia fuente.</p></div></div>
            </div>
          </Card>
          <Card className="next-step-card">
            <h2>Consulta los registros importados</h2>
            <p>Revisa los campos originales, las fechas y la procedencia antes de investigar.</p>
            <a href="#/eventos" className="text-link"><Database size={13} aria-hidden="true" />Abrir Eventos<ArrowRight size={13} aria-hidden="true" /></a>
          </Card>
        </div>
      </div>
    </>
  );
}

