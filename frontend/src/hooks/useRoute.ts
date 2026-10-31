import { useSyncExternalStore } from 'react';
import { getRoute } from '../lib/navigation';

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};
const snapshot = () => getRoute(window.location.hash);
export const useRoute = () => useSyncExternalStore(subscribe, snapshot);
