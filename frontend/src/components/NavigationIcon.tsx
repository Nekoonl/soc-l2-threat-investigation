import { LayoutDashboard, ListFilter, FolderSearch, Upload, FileText, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PageId } from '../lib/navigation';

const icons: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  eventos: ListFilter,
  incidentes: FolderSearch,
  importacion: Upload,
  informes: FileText,
  configuracion: Settings2,
};

export function NavigationIcon({ page }: { page: PageId }) {
  const Icon = icons[page];
  return <Icon size={18} strokeWidth={1.7} aria-hidden="true" />;
}
