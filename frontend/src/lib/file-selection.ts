export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Only inspect metadata. This stage never reads, uploads or analyzes file contents. */
export function validateFileSelection(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) return 'Selecciona un archivo CSV o Excel con extensión .xlsx.';
  if (file.size === 0) return 'El archivo está vacío. Selecciona un archivo que contenga datos.';
  if (file.size > MAX_FILE_BYTES) return 'El archivo supera el límite previsto de 10 MB.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('es-PA', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es-PA', { maximumFractionDigits: 1 })} MB`;
}
