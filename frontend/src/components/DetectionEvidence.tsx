import { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { Button } from './ui';
import { EventDetailDialog } from './EventDetailDialog';
import { eventTime } from '../lib/event-time';
import { sourceText } from '../lib/source-fields';
import type { EventRecord } from '../services/events';

export function DetectionEvidence({ events }: { events: EventRecord[] }) {
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);
  const pages = Math.max(1, Math.ceil(events.length / 10));
  return <div className="soc-evidence">
    <div className="table-scroll" role="region" aria-label="Evidencias de la alerta" tabIndex={0}><table className="event-records-table"><thead><tr><th scope="col">LOG_ID / HORA ORIGINAL</th><th scope="col">EVIDENCIA DE ORIGEN</th><th scope="col">DETALLE</th></tr></thead>
      <tbody>{events.slice((page - 1) * 10, page * 10).map(event => {
        const time = eventTime(event);
        return <tr key={event.id}><td><strong>{sourceText(event, 'log_id')}</strong><small>{time.value} · {time.zone}</small><small>{sourceText(event, 'hostname')} / {sourceText(event, 'username')}</small></td>
          <td>{sourceText(event, 'src_ip')}<small>Severity original: {sourceText(event, 'source_severity')}</small>
            <details open><summary>Descripción y comando</summary><pre className="event-text-block">{sourceText(event, 'event_description', event.message)}{'\n'}{sourceText(event, 'process_commandline')}</pre></details>
            <small>{event.filename} · fila {event.row_number} · importación #{event.import_id}</small></td>
          <td><button className="icon-button" onClick={() => setDetailId(event.id)} aria-label={`Ver evidencia ${sourceText(event, 'log_id')}`}><Eye size={16} aria-hidden="true" /></button></td></tr>;
      })}</tbody></table></div>
    <div className="table-pagination"><span>{events.length} eventos vinculados · página {page} de {pages}</span><div><Button aria-label="Evidencias anteriores" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} aria-hidden="true" /></Button><Button aria-label="Evidencias siguientes" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} aria-hidden="true" /></Button></div></div>
    {detailId !== null && <EventDetailDialog eventId={detailId} onClose={() => setDetailId(null)} />}
  </div>;
}
