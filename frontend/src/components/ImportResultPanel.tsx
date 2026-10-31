import { Check, Info } from 'lucide-react';
import type { ImportResult } from '../services/events';
import { Badge } from './ui';

export function ImportResultPanel({ result }: { result: ImportResult }) {
  return <section className="import-result-panel" aria-label="Resultado de la importación">
    <div className="import-result-heading"><h3><Check size={16} aria-hidden="true" />{result.accepted ? 'Registros importados' : result.duplicates ? 'Archivo procesado sin registros nuevos' : 'Archivo conservado sin filas válidas'}</h3><Badge tone={result.rejected ? 'amber' : 'teal'}>Importación #{result.id}</Badge></div>
    <dl className="import-counts">
      <div><dt>Importados</dt><dd>{result.accepted.toLocaleString('es-PA')}</dd></div>
      <div><dt>Duplicados</dt><dd>{result.duplicates.toLocaleString('es-PA')}</dd></div>
      <div><dt>Rechazados</dt><dd>{result.rejected.toLocaleString('es-PA')}</dd></div>
      <div><dt>Filas procesadas</dt><dd>{result.total_rows.toLocaleString('es-PA')}</dd></div>
    </dl>
    <p>Archivo: <strong>{result.filename}</strong>{result.sheet_name && <> · Hoja: {result.sheet_name}</>}</p>
    <p className="evidence-hash">SHA-256: <code>{result.sha256}</code></p>
    <p>Se conservaron el archivo original y la procedencia de las filas válidas, incluidas las duplicadas. No se ejecutaron detecciones SOC.</p>
    {result.unknown_timezone > 0 && <p className="timezone-warning"><Info size={14} aria-hidden="true" />{result.unknown_timezone} registros válidos conservan su hora sin zona indicada; no se convirtieron a UTC.</p>}
    {result.errors.length > 0 && <details open><summary>Errores de filas ({result.error_count}; se muestran hasta 100)</summary><ul>{result.errors.map((error, index) => <li key={`${error.row}-${index}`}>Fila {error.row}{error.log_id && ` · Log_ID ${error.log_id}`}: {error.error}</li>)}</ul></details>}
    <details><summary>Mapeo de columnas aplicado</summary><dl className="applied-mapping">{Object.entries(result.mapping).map(([field, column]) => <div key={field}><dt>{column}</dt><dd>{field}</dd></div>)}</dl>{result.unmapped_columns.length > 0 && <p>Columnas sin normalizar, conservadas en el registro original: {result.unmapped_columns.join(', ')}.</p>}</details>
    <a href="#/eventos" className="button button-secondary">Ver eventos almacenados</a>
  </section>;
}
