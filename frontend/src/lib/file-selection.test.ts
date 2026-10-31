import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, validateFileSelection } from './file-selection';

describe('Validación local de metadatos', () => {
  it('admite CSV y XLSX sin distinguir mayúsculas', () => {
    expect(validateFileSelection({ name: 'logs.CSV', size: 20 })).toBeNull();
    expect(validateFileSelection({ name: 'logs.xlsx', size: MAX_FILE_BYTES })).toBeNull();
  });
  it('rechaza archivos vacíos, mayores al límite y formatos no previstos', () => {
    expect(validateFileSelection({ name: 'logs.csv', size: 0 })).toContain('vacío');
    expect(validateFileSelection({ name: 'logs.csv', size: MAX_FILE_BYTES + 1 })).toContain('10 MB');
    expect(validateFileSelection({ name: 'logs.csv.exe', size: 20 })).toContain('extensión');
  });
});
