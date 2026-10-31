export const navigation = [
  { id: 'dashboard', label: 'Resumen', group: 'investigation' },
  { id: 'eventos', label: 'Eventos', group: 'investigation' },
  { id: 'incidentes', label: 'Investigaciones', group: 'investigation' },
  { id: 'importacion', label: 'Importar registros', group: 'workspace' },
  { id: 'informes', label: 'Informes', group: 'workspace' },
  { id: 'configuracion', label: 'Configuración', group: 'workspace' },
] as const;

export type PageId = typeof navigation[number]['id'];
export type Route = PageId | 'not-found';

export function getRoute(hash: string): Route {
  if (!hash || hash === '#' || hash === '#/') return 'dashboard';
  const path = hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return navigation.find(item => item.id === path)?.id ?? 'not-found';
}

export function pageHref(page: PageId) { return `#/${page}`; }
