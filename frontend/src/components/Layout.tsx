import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ShieldCheck, PanelLeftClose, PanelLeftOpen, Menu, X, ChevronRight, Monitor, LockKeyhole, CircleHelp } from 'lucide-react';
import { navigation, pageHref } from '../lib/navigation';
import type { Route } from '../lib/navigation';
import { BackendIndicator } from './BackendIndicator';
import { NavigationIcon } from './NavigationIcon';

function Sidebar({ route, mobile = false, collapsed = false, onNavigate }: { route: Route; mobile?: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  return <aside className={`sidebar ${mobile ? 'sidebar-mobile' : 'sidebar-desktop'}`} aria-label={mobile ? 'Navegación móvil' : 'Navegación principal'}>
    <a className="brand" href={pageHref('dashboard')} onClick={onNavigate} aria-label="SOC L2, resumen" title={collapsed ? 'SOC L2 · Resumen' : undefined}><span className="brand-symbol"><ShieldCheck size={29} strokeWidth={1.5} aria-hidden="true" /></span><span className="brand-name">SOC <span>L2</span><small>THREAT INVESTIGATION</small></span></a>
    <nav id={mobile ? 'mobile-navigation' : 'desktop-navigation'} aria-label={mobile ? 'Secciones móviles' : 'Secciones de la plataforma'}>
      {navigation.map(item => <a key={item.id} className={`nav-link ${route === item.id ? 'nav-link-active' : ''}`} href={pageHref(item.id)} aria-label={item.label} title={collapsed ? item.label : undefined} aria-current={route === item.id ? 'page' : undefined} onClick={onNavigate}><NavigationIcon page={item.id} /><span className="nav-label">{item.label}</span>{route === item.id && <span className="nav-active-dot" aria-hidden="true" />}</a>)}
    </nav>
    <div className="sidebar-bottom"><div className="local-environment" title="Ejecución local · Windows · localhost"><span className="environment-icon"><LockKeyhole size={17} aria-hidden="true" /></span><div className="environment-copy">Ejecución local<small>Windows · localhost</small></div></div></div>
  </aside>;
}

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const mobileMenu = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  const previousRoute = useRef(route);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = useCallback(() => { mobileMenu.current?.close(); setMobileOpen(false); }, []);
  useEffect(() => {
    if (!window.matchMedia) return;
    const desktop = window.matchMedia('(min-width: 901px)');
    const onResize = () => { if (desktop.matches) closeMenu(); };
    desktop.addEventListener('change', onResize);
    return () => desktop.removeEventListener('change', onResize);
  }, [closeMenu]);
  const title = navigation.find(item => item.id === route)?.label ?? 'Página no encontrada';
  useEffect(() => {
    document.title = `${title} | SOC L2`;
    if (previousRoute.current !== route) {
      main.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
    previousRoute.current = route;
  }, [route, title]);
  return <div className={`workspace-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Saltar al contenido</a><Sidebar route={route} collapsed={collapsed} /><dialog ref={mobileMenu} className="mobile-nav-dialog" aria-label="Menú de navegación" onCancel={event => { event.preventDefault(); closeMenu(); }} onClose={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}><button className="icon-button close-mobile-menu" onClick={closeMenu} aria-label="Cerrar navegación"><X size={20} aria-hidden="true" /></button><Sidebar route={route} mobile onNavigate={closeMenu} /></dialog><div className="app-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu-trigger" aria-label="Abrir navegación" aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => { mobileMenu.current?.showModal(); setMobileOpen(true); }}><Menu size={20} aria-hidden="true" /></button><button className="icon-button desktop-menu-toggle" aria-label={collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'} title={collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'} aria-expanded={!collapsed} aria-controls="desktop-navigation" onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}</button><span className="breadcrumb-parent">Plataforma</span><ChevronRight size={14} className="breadcrumb-chevron" aria-hidden="true" /><strong>{title}</strong></div><div className="topbar-status"><BackendIndicator /><span className="local-label"><Monitor size={16} aria-hidden="true" />Local</span><a href={pageHref('configuracion')} className="icon-button topbar-help" aria-label="Información de la aplicación"><CircleHelp size={19} aria-hidden="true" /></a></div></header><main id="main-content" ref={main} tabIndex={-1}><div className="page-content">{children}</div><footer className="app-footer"><span>SOC L2 · Threat Investigation Platform</span><span>Comunidad DOJO & WoSEC Panamá</span></footer></main></div></div>;
}
