import { useEffect, useRef, useState } from 'react';
import { X, LoaderCircle, FileSearch } from 'lucide-react';
import { Badge, Button, Notice } from './ui';
import { eventTime } from '../lib/event-time';
import { sourceText } from '../lib/source-fields';
import { getEventDetail } from '../services/events';
import type { EventDetail } from '../services/events';

function RawFields({ values }: { values: Record<string, string> }) {
  return <dl className="event-raw-fields">{Object.entries(values).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value.trim() ? value : 'Vacío en el archivo'}</dd></div>)}</dl>;
}

export function EventDetailDialog({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null);
    setError('');
    getEventDetail(eventId, controller.signal).then(result => {
      if (!controller.signal.aborted) setEvent(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el evento.');
    });
    return () => controller.abort();
  }, [eventId, retry]);

  const time = event ? eventTime(event) : null;
  return <dialog ref={dialog} className="event-detail-dialog" aria-labelledby="event-detail-title" onCancel={onClose}
    onClick={click => { if (click.target === click.currentTarget) onClose(); }}>
    <div className="event-dialog-header"><div><span className="eyebrow">EVIDENCIA ALMACENADA · ID INTERNO #{eventId}</span><h2 id="event-detail-title">Detalle del evento</h2></div><button className="icon-button" aria-label="Cerrar detalle del evento" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    <div className="event-dialog-body">
      {error && <div className="event-query-error" role="alert"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>Reintentar detalle</Button></div>}
      {!event && !error && <p className="event-loading" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Consultando evidencia…</p>}
      {event && <>
        <div className="event-detail-badges"><Badge tone="blue">Log_ID: {sourceText(event, 'log_id')}</Badge><Badge>Severidad de origen: {sourceText(event, 'source_severity')}</Badge>{event.synthetic && <Badge tone="amber">Registro sintético heredado</Badge>}</div>
        {event.provenance?.legacy_normalization && <Notice>Registro con normalización heredada. Esta vista recupera los campos originales conservados sin modificar SQLite. Los valores normalizados persistidos se muestran por separado y requieren revisión antes de utilizarlos en correlación.</Notice>}
        {event.provenance && !event.provenance.original_file_stored && <Notice>El archivo binario original no se conservó en esta importación. El hash registrado y las filas originales están disponibles, pero no permiten verificar por sí solos el Excel oficial.</Notice>}
        <dl className="event-normalized-fields">
          <div><dt>Fecha / hora presentada</dt><dd>{time?.value}<small>{time?.zone}</small></dd></div>
          <div><dt>Timestamp de origen</dt><dd>{event.source_fields?.timestamp === 'missing' ? 'No documentado en origen' : event.timestamp_original !== undefined ? event.timestamp_original || 'Vacío en el archivo' : event.raw.Timestamp || event.raw.timestamp || 'No documentado'}</dd></div>
          <div><dt>Declaración de zona del archivo</dt><dd>{event.provenance?.declared_timezone || 'Sin declaración registrada'}</dd></div>
          <div><dt>Host / usuario de origen</dt><dd>{sourceText(event, 'hostname')} / {sourceText(event, 'username')}</dd></div>
          <div><dt>Origen / destino</dt><dd>{sourceText(event, 'src_ip')} → {sourceText(event, 'destination', event.dst_ip)}</dd></div>
          <div><dt>Event_ID / Log_Source</dt><dd>{sourceText(event, 'event_id')} / {sourceText(event, 'log_source')}</dd></div>
          <div><dt>Resultado</dt><dd>{sourceText(event, 'status')}</dd></div>
        </dl>
        {time?.zone === 'Zona no indicada' && <p className="event-detail-note">La fecha original no establece un instante UTC. Las ventanas temporales requieren una zona documentada o un ámbito de reloj relativo explícito; no se usa la conversión histórica como evidencia temporal.</p>}
        <h3>Descripción del evento</h3><pre className="event-text-block">{sourceText(event, 'event_description', event.message)}</pre>
        <h3>Línea de comandos de origen</h3><pre className="event-text-block">{sourceText(event, 'process_commandline')}</pre>
        <p className="event-detail-note">El contenido se muestra como texto; no se ejecuta ni se interpreta como HTML. Este registro no constituye por sí mismo un incidente confirmado.</p>
        <h3><FileSearch size={15} aria-hidden="true" />Procedencia y valores originales</h3>
        <p className="event-detail-note">Primera procedencia: {event.filename} · fila {event.row_number}{event.sheet_name && ` · hoja ${event.sheet_name}`}.</p>
        <p className="event-detail-note">Registro de importación #{event.import_id}{event.provenance?.import_created_at && ` · ${event.provenance.import_created_at}`}{!event.sheet_name && ' · Hoja no registrada'}.</p>
        <p className="evidence-hash">SHA-256 registrado en la importación: <code>{event.file_sha256}</code></p>
        <RawFields values={event.raw} />
        {event.stored_normalized && <details><summary>Valores normalizados almacenados — sin modificar</summary><dl className="event-raw-fields">{Object.entries(event.stored_normalized).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value === null ? 'null' : String(value) || 'Vacío normalizado'}</dd></div>)}</dl></details>}
        <h3>Ocurrencias conservadas ({event.occurrences.length})</h3>
        {event.occurrences.length ? event.occurrences.map(occurrence => <details className="event-occurrence" key={occurrence.id}><summary>Importación #{occurrence.import_id} · {occurrence.filename} · fila {occurrence.row_number}{occurrence.sheet_name && ` · ${occurrence.sheet_name}`}</summary><p>Log_ID de origen: {occurrence.source_log_id || 'No indicado'}</p><p className="evidence-hash">SHA-256: <code>{occurrence.sha256}</code></p><RawFields values={occurrence.raw} /></details>) : <p className="event-detail-note">Registro anterior a la trazabilidad ampliada; se conserva la procedencia original disponible.</p>}
      </>}
    </div>
  </dialog>;
}
