import { useBackend } from '../hooks/useBackend';
import { Badge } from './ui';

export function BackendIndicator() {
  const { status } = useBackend();
  return <span role="status" className="backend-indicator"><Badge dot tone={status === 'available' ? 'teal' : status === 'unavailable' ? 'amber' : 'neutral'}>{status === 'available' ? 'Backend disponible' : status === 'unavailable' ? 'Backend sin conexión' : 'Comprobando backend'}</Badge></span>;
}
