import { describe, expect, it } from 'vitest';
import { getRoute, navigation, pageHref } from './navigation';

describe('Rutas locales', () => {
  it('reconoce las seis secciones y sus enlaces directos', () => {
    for (const item of navigation) expect(getRoute(pageHref(item.id))).toBe(item.id);
  });
  it('abre dashboard por defecto y reconoce rutas desconocidas', () => {
    expect(getRoute('')).toBe('dashboard');
    expect(getRoute('#/')).toBe('dashboard');
    expect(getRoute('#/configuracion/')).toBe('configuracion');
    expect(getRoute('#/otra-pagina')).toBe('not-found');
  });
});
