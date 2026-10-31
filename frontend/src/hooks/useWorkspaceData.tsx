import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getDashboardSummary } from '../services/dashboard';
import type { DashboardSummary } from '../services/dashboard';
import type { DetectionPreview } from '../services/detections';

export interface SummaryState { data: DashboardSummary | null; loading: boolean; error: string; }
interface WorkspaceData {
  summary: SummaryState; lastPreview: DetectionPreview | null;
  loadSummary: (force?: boolean) => Promise<void>;
  recordPreview: (preview: DetectionPreview) => void;
  invalidateDataset: () => void;
}
const Context = createContext<WorkspaceData | null>(null);
const empty: SummaryState = { data: null, loading: false, error: '' };

/** Session memory only. Route changes do not execute previews or refetch cached summaries. */
export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<SummaryState>(empty);
  const [lastPreview, setLastPreview] = useState<DetectionPreview | null>(null);
  const summaryRef = useRef<DashboardSummary | null>(null);
  const previewRef = useRef<DetectionPreview | null>(null);
  const active = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);

  const loadSummary = useCallback((force = false): Promise<void> => {
    if (!force && summaryRef.current) return Promise.resolve();
    if (!force && active.current) return active.current.promise;
    active.current?.controller.abort();
    const controller = new AbortController();
    summaryRef.current = null;
    setSummary({ data: null, loading: true, error: '' });
    const promise = getDashboardSummary(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      summaryRef.current = data;
      if (previewRef.current && previewRef.current.dataset.revision !== data.dataset_revision) {
        previewRef.current = null; setLastPreview(null);
      }
      setSummary({ data, loading: false, error: '' });
    }).catch(failure => {
      if (!controller.signal.aborted) setSummary({ data: null, loading: false, error: failure instanceof Error ? failure.message : 'No se pudo consultar el resumen.' });
    }).finally(() => { if (active.current?.controller === controller) active.current = null; });
    active.current = { controller, promise };
    return promise;
  }, []);

  const invalidateDataset = useCallback(() => {
    active.current?.controller.abort(); active.current = null;
    summaryRef.current = null; previewRef.current = null;
    setSummary(empty); setLastPreview(null);
  }, []);
  const recordPreview = useCallback((preview: DetectionPreview) => {
    previewRef.current = preview; setLastPreview(preview);
    if (summaryRef.current && summaryRef.current.dataset_revision !== preview.dataset.revision) {
      active.current?.controller.abort(); active.current = null;
      summaryRef.current = null; setSummary(empty);
    }
  }, []);
  useEffect(() => () => { active.current?.controller.abort(); active.current = null; }, []);
  return <Context.Provider value={{ summary, lastPreview, loadSummary, recordPreview, invalidateDataset }}>{children}</Context.Provider>;
}
export function useWorkspaceData() {
  const context = useContext(Context);
  if (!context) throw new Error('useWorkspaceData requiere WorkspaceDataProvider.');
  return context;
}
