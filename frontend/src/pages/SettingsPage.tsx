import { RefreshCw, Server, Monitor, Database, BrainCircuit, ShieldCheck, CircleHelp } from 'lucide-react';
import { useBackend } from '../hooks/useBackend';
import { Badge, Button, Card, ContextHelp, Notice, PageHeader } from '../components/ui';

export function SettingsPage() {
  const { status, health, checkedAt, check, error } = useBackend();
  return <>
    <PageHeader eyebrow="ENTORNO LOCAL" title="Configuración" description="Estado de los servicios e información de la plataforma."
      action={<Button onClick={() => void check()} disabled={status === 'checking'}><RefreshCw size={16} className={status === 'checking' ? 'spin' : ''} aria-hidden="true" />Comprobar backend</Button>} />
    <div className="settings-grid">
      <Card title="Estado de servicios" className="service-card">
        <div className="service-list">
          <div className="service-row"><span className="service-icon"><Monitor size={20} aria-hidden="true" /></span><div><h3>Interfaz web</h3><p>{window.location.origin}</p></div><Badge tone="teal" dot>Disponible</Badge></div>
          <div className="service-row"><span className="service-icon"><Server size={20} aria-hidden="true" /></span><div><h3>Backend local</h3><p>127.0.0.1:8000</p></div><Badge tone={status === 'available' ? 'teal' : status === 'unavailable' ? 'amber' : 'neutral'} dot>{status === 'available' ? 'Disponible' : status === 'unavailable' ? 'Sin conexión' : 'Comprobando'}</Badge></div>
          <div className="service-row"><span className="service-icon"><Database size={20} aria-hidden="true" /></span><div><h3>Motor SOC</h3><p>Cinco reglas · ejecución desde Investigaciones</p></div><Badge tone="blue">Vista previa manual</Badge></div>
          <div className="service-row"><span className="service-icon"><BrainCircuit size={20} aria-hidden="true" /></span><div><h3>IA en tiempo de ejecución</h3><p>Pendiente de definición</p></div><Badge>Sin integrar</Badge></div>
        </div>
        <div className="service-check-time"><RefreshCw size={14} aria-hidden="true" />{checkedAt ? `Última comprobación: ${checkedAt.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Comprobación en curso'}</div>
      </Card>
      <Card title="Información de la aplicación" className="app-information">
        <dl><div><dt>Aplicación</dt><dd>SOC L2</dd></div><div><dt>Ejecución</dt><dd>Local · Windows</dd></div><div><dt>Frontend</dt><dd>React + TypeScript</dd></div><div><dt>Backend</dt><dd>Python + Starlette</dd></div><div><dt>Almacenamiento</dt><dd>SQLite</dd></div><div><dt>Servicio observado</dt><dd>{health ? `${health.app} · v${health.version}` : 'No disponible'}</dd></div></dl>
      </Card>
    </div>
    {status === 'unavailable' && <Notice><strong>No se pudo comprobar el backend.</strong> <span role="alert">{error}</span> Revisa los servicios locales y pulsa «Comprobar backend».</Notice>}
    <div className="settings-bottom">
      <Card title="Alcance de la plataforma"><div className="scope-content"><span className="scope-icon"><ShieldCheck size={24} aria-hidden="true" /></span><div><h3>Investigación basada en evidencias</h3><p>Importación, exploración de eventos, resumen de datos, alertas en vista previa e informes PDF.</p><p>Las alertas requieren validación. La vista previa no guarda investigaciones ni modifica notas.</p></div></div></Card>
      <Card title="Acerca del proyecto"><div className="about-content"><span className="about-icon"><CircleHelp size={23} aria-hidden="true" /></span><h3>Comunidad DOJO × WoSEC Panamá</h3><p>Proyecto final del Bootcamp Analista SOC Nivel 2.</p><span className="about-caption">SOC L2 | Threat Investigation Platform</span></div></Card>
    </div>
    <ContextHelp title="Información técnica y límites"><p>La disponibilidad del backend se comprueba mediante su API de salud. El estado del dataset se consulta por separado en Resumen y Eventos.</p><p>Zona heredada del prototipo: {health?.timezone ?? 'sin consultar'}. Ese valor no documenta la zona de los eventos. Las fechas sin evidencia de zona se muestran como «Zona no indicada».</p><p>La aplicación funciona mediante localhost y no incorpora autenticación. Codex es el asistente de desarrollo; el motor SOC utiliza reglas deterministas, no IA generativa.</p><p>Guías de inicio y verificación: <code>frontend/README.md</code> y <code>docs/PROJECT_PLAN.md</code>.</p></ContextHelp>
  </>;
}
