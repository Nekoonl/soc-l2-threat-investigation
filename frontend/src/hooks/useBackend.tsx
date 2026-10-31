import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getBackendHealth } from '../services/backend';
import type { BackendHealth } from '../services/backend';

export type BackendStatus = 'checking' | 'available' | 'unavailable';
interface BackendState {
  status: BackendStatus;
  health: BackendHealth | null;
  checkedAt: Date | null;
  error: string;
}
interface BackendContextValue extends BackendState { check: () => Promise<void>; }
const BackendContext = createContext<BackendContextValue | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState>({ status: 'checking', health: null, checkedAt: null, error: '' });
  const activeRequest = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState(previous => ({ ...previous, status: 'checking', error: '' }));
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const health = await getBackendHealth(controller.signal);
      if (activeRequest.current === controller) setState({ status: 'available', health, checkedAt: new Date(), error: '' });
    } catch (failure) {
      if (activeRequest.current === controller) setState({ status: 'unavailable', health: null, checkedAt: new Date(),
        error: controller.signal.aborted ? 'La comprobación del backend superó los 5 segundos.' : failure instanceof Error ? failure.message : 'No se pudo comprobar la API local.' });
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void check();
    return () => { activeRequest.current?.abort(); activeRequest.current = null; };
  }, [check]);

  return <BackendContext.Provider value={{ ...state, check }}>{children}</BackendContext.Provider>;
}

export function useBackend() {
  const context = useContext(BackendContext);
  if (!context) throw new Error('useBackend debe utilizarse dentro de BackendProvider.');
  return context;
}
