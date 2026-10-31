import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Info, Clock3 } from 'lucide-react';

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'teal' | 'amber'; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="badge-dot" aria-hidden="true" />}{children}</span>;
}

export function PendingBadge() { return <Badge><Clock3 size={12} aria-hidden="true" />Pendiente de integración</Badge>; }

export function PriorityBadge({ level, score }: { level: 'critical' | 'high' | 'medium' | 'low'; score: number }) {
  const labels = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };
  return <Badge tone={level === 'critical' || level === 'high' ? 'amber' : 'blue'}>Prioridad {labels[level]} · {score}/100</Badge>;
}

export function Card({ title, description, action, children, className = '', bodyClassName = '' }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  const headingId = useId();
  return <section className={`card ${className}`} aria-labelledby={title ? headingId : undefined}>
    {title && <div className="card-header"><div><h2 id={headingId}>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}
    <div className={bodyClassName}>{children}</div>
  </section>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow"><span aria-hidden="true" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</div>;
}

export function EmptyState({ icon: Icon, title, description, children, compact = false }: { icon: LucideIcon; title: string; description: string; children?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}><span className="empty-state-icon"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p>{children}</div>;
}

export function Notice({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`notice ${className}`}><Info size={17} aria-hidden="true" /><p>{children}</p></div>;
}

/** Native disclosure keeps methodology available without hiding actionable warnings. */
export function ContextHelp({ title, children }: { title: string; children: ReactNode }) {
  return <details className="context-help"><summary>{title}</summary><div>{children}</div></details>;
}

export function EmptyTable({ columns, icon, title, description, action }: { columns: string[]; icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length}><EmptyState icon={icon} title={title} description={description}>{action}</EmptyState></td></tr></tbody></table></div>;
}
