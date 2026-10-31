import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, ListFilter, Upload, X, Database, RefreshCw, LoaderCircle, Eye } from 'lucide-react';
import { Badge, Button, Card, ContextHelp, EmptyState, PageHeader } from '../components/ui';
import { EventDetailDialog } from '../components/EventDetailDialog';
import { pageHref } from '../lib/navigation';
import { eventTime } from '../lib/event-time';
import { sourceText } from '../lib/source-fields';
import { getEvents, getEventOptions } from '../services/events';
import type { EventOptions, EventPage } from '../services/events';

const emptyOptions: EventOptions = { log_source: [], hostname: [], status: [], source_severity: [], imports: [] };

export function EventsPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [hostname, setHostname] = useState('');
  const [importId, setImportId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [reload, setReload] = useState(0);
  const [options, setOptions] = useState<EventOptions>(emptyOptions);
  const [optionsError, setOptionsError] = useState('');
  const [data, setData] = useState<EventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const hasFilters = Boolean(query || source || status || severity || hostname || importId);
  const selectedImport = options.imports.find(item => String(item.id) === importId);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsError('');
    getEventOptions(controller.signal).then(result => {
      if (!controller.signal.aborted) setOptions(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setOptionsError(failure instanceof Error ? failure.message : 'No se pudieron cargar los filtros.');
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), q: search });
    for (const [name, value] of Object.entries({ log_source: source, status, source_severity: severity, hostname, import_id: importId })) {
      if (value) params.set(name, value);
    }
    setLoading(true);
    setError('');
    getEvents(params, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setData(null);
        setError(failure instanceof Error ? failure.message : 'No se pudieron consultar los eventos.');
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, source, status, severity, hostname, importId, page, pageSize, reload]);

  function clearFilters() {
    setQuery(''); setSearch(''); setSource(''); setStatus(''); setSeverity(''); setHostname(''); setImportId(''); setPage(1);
  }

  return (
    <>
      <PageHeader eyebrow="EXPLORACIÓN DE EVIDENCIAS" title="Eventos"
        description="Busca registros originales y consulta su procedencia."
        action={<a href={pageHref('importacion')} className="button button-primary"><Upload size={15} aria-hidden="true" />Importar registros</a>} />
      <div className="section-summary">
        <span><Database size={15} aria-hidden="true" />{loading ? 'Consultando registros…' : data ? `${data.dataset_total.toLocaleString('es-PA')} eventos almacenados` : 'Consulta no disponible'}</span>
        <div className="events-summary-actions"><Badge tone={error ? 'amber' : data ? 'teal' : 'neutral'}>{error ? 'Error de conexión' : data ? 'Datos de origen' : 'Consultando'}</Badge><Button onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={14} aria-hidden="true" />Actualizar eventos</Button></div>
      </div>
      <Card className="events-card">
        <div className="filter-toolbar">
          <label className="search-input"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Buscar eventos" maxLength={200}
            placeholder="Buscar Log_ID, IP, usuario, host o descripción…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
          <label className="select-control"><SlidersHorizontal size={14} aria-hidden="true" /><select aria-label="Filtrar por origen de eventos" value={source} onChange={event => { setSource(event.target.value); setPage(1); }}>
            <option value="">Todas las fuentes</option>{options.log_source.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <select aria-label="Filtrar por resultado" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Todos los resultados</option>{options.status.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="events-secondary-filters">
          <label>Hostname<select aria-label="Filtrar por host" value={hostname} onChange={event => { setHostname(event.target.value); setPage(1); }}><option value="">Todos los hosts</option>{options.hostname.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Severidad de origen<select aria-label="Filtrar por severidad de origen" value={severity} onChange={event => { setSeverity(event.target.value); setPage(1); }}><option value="">Todas las severidades</option>{options.source_severity.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Importación<select aria-label="Filtrar por importación" value={importId} onChange={event => { setImportId(event.target.value); setPage(1); }}><option value="">Todos los archivos</option>{options.imports.map(item => <option key={item.id} value={String(item.id)}>#{item.id} · {item.filename}</option>)}</select></label>
        </div>
        {selectedImport && <p className="events-import-summary">Importación #{selectedImport.id}: {selectedImport.accepted} importados · {selectedImport.duplicates} duplicados · {selectedImport.rejected} rechazados. Los duplicados pueden aparecer por su procedencia conservada.</p>}
        <div className="table-context"><span>EXPLORADOR DE EVENTOS</span><div>{hasFilters && <Button variant="quiet" onClick={clearFilters}><X size={13} aria-hidden="true" />Limpiar filtros</Button>}<Badge>{loading ? 'Consultando' : data ? `${data.total.toLocaleString('es-PA')} coincidencias` : 'Sin respuesta'}</Badge></div></div>
        {optionsError && <div className="event-filter-error" role="alert">Filtros no disponibles: {optionsError}</div>}
        {error && <div className="event-query-error" role="alert"><p>{error}</p><Button onClick={() => setReload(value => value + 1)}>Reintentar consulta</Button></div>}
        <div className="table-scroll" role="region" aria-label="Tabla de eventos" tabIndex={0} aria-busy={loading}>
          <table className="event-records-table">
            <caption className="sr-only">Registros originales; desplázate horizontalmente para consultar todas las columnas.</caption>
            <thead><tr>{['LOG_ID', 'FECHA / HORA', 'HOST / USUARIO', 'ORIGEN / DESTINO', 'EVENT_ID / FUENTE', 'RESULTADO', 'SEVERIDAD DE ORIGEN', 'DETALLE'].map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8}><p className="event-loading" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Consultando registros…</p></td></tr>
                : data?.events.length ? data.events.map(event => {
                  const time = eventTime(event);
                  return <tr key={event.id}>
                    <td><strong>{sourceText(event, 'log_id')}</strong><small>ID interno #{event.id}</small></td>
                    <td className="event-time-cell">{time.value}<small>{time.zone}</small></td>
                    <td>{sourceText(event, 'hostname')}<small>{sourceText(event, 'username')}</small></td>
                    <td>{sourceText(event, 'src_ip')}<small>{sourceText(event, 'destination', event.dst_ip)}</small></td>
                    <td>{sourceText(event, 'event_id', event.event_type)}<small>{sourceText(event, 'log_source')}</small></td>
                    <td><Badge>{sourceText(event, 'status')}</Badge></td>
                    <td><Badge tone="blue">{sourceText(event, 'source_severity')}</Badge></td>
                    <td><button className="icon-button" onClick={() => setSelectedEvent(event.id)} aria-label={`Ver evento ${sourceText(event, 'log_id', String(event.id))}`}><Eye size={17} aria-hidden="true" /></button></td>
                  </tr>;
                }) : !error && <tr><td colSpan={8}><EmptyState icon={ListFilter} title={hasFilters ? 'Sin coincidencias' : 'Sin registros importados'} description={hasFilters ? 'No hay eventos que coincidan con la búsqueda y los filtros actuales.' : 'Importa tu Excel o CSV para explorar sus registros reales y su procedencia.'} /></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>{loading ? 'Consultando…' : data ? `${data.total ? (data.page - 1) * data.page_size + 1 : 0}–${Math.min(data.page * data.page_size, data.total)} de ${data.total} coincidencias` : 'Sin datos disponibles'}</span>
          <div><label>Filas por página<select aria-label="Filas por página" value={String(pageSize)} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            <span>{data ? data.total ? `${data.page} de ${data.pages}` : '0 de 0' : '— de —'}</span>
            <Button disabled={loading || !data || data.page <= 1} aria-label="Página anterior" onClick={() => setPage((data?.page || 1) - 1)}><ChevronLeft size={15} aria-hidden="true" /></Button>
            <Button disabled={loading || !data || data.page >= data.pages} aria-label="Página siguiente" onClick={() => setPage((data?.page || 1) + 1)}><ChevronRight size={15} aria-hidden="true" /></Button>
          </div>
        </div>
      </Card>
      <ContextHelp title="Cómo interpretar los campos y las fechas"><p>Se muestran los valores originales. «Vacío en el archivo» se distingue de una columna no indicada. La severidad de origen no es la prioridad calculada de una alerta.</p><p>Las fechas sin zona se identifican en cada fila y no se convierten a UTC. El detalle permite revisar el comando, los campos completos y la procedencia.</p></ContextHelp>
      {selectedEvent !== null && <EventDetailDialog eventId={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </>
  );
}

