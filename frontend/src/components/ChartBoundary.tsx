import { Component } from 'react';
import type { ReactNode } from 'react';

/** A failed chart chunk/render must not blank the workspace or its evidence. */
export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="dashboard-summary-error" role="alert">No se pudieron mostrar los gráficos. Las métricas y la navegación siguen disponibles. Recarga la página para reintentar.</div> : this.props.children;
  }
}
