import { FileQuestion, ArrowLeft } from 'lucide-react';
import { BackendProvider } from './hooks/useBackend';
import { useBackend } from './hooks/useBackend';
import { WorkspaceDataProvider, useWorkspaceData } from './hooks/useWorkspaceData';
import { useRoute } from './hooks/useRoute';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { EventsPage } from './pages/EventsPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { ImportPage } from './pages/ImportPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

function RoutedApp() {
  const route = useRoute();
  const workspace = useWorkspaceData();
  const backend = useBackend();
  const pages = {
    dashboard: <DashboardPage summary={workspace.summary} preview={workspace.lastPreview} loadSummary={workspace.loadSummary} backendStatus={backend.status} />,
    eventos: <EventsPage />,
    incidentes: <IncidentsPage onPreviewCompleted={workspace.recordPreview} initialPreview={workspace.lastPreview} />,
    importacion: <ImportPage onDatasetChanged={workspace.invalidateDataset} />,
    informes: <ReportsPage summary={workspace.summary} preview={workspace.lastPreview} loadSummary={workspace.loadSummary} />,
    configuracion: <SettingsPage />,
    'not-found': <EmptyState icon={FileQuestion} title="Página no encontrada" description="Esta dirección no corresponde a una sección de la plataforma."><a href="#/dashboard" className="button button-primary"><ArrowLeft size={15} aria-hidden="true" />Volver al resumen</a></EmptyState>,
  };
  return <Layout route={route}>{pages[route]}</Layout>;
}

export function App() { return <BackendProvider><WorkspaceDataProvider><RoutedApp /></WorkspaceDataProvider></BackendProvider>; }
