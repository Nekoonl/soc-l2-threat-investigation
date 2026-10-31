import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartNoAxesCombined } from 'lucide-react';
import { EmptyState } from './ui';
import type { DistributionItem } from '../services/dashboard';

const palette = ['#3B82F6', '#18A999', '#829AB8', '#A5B6CC', '#42658A', '#5A8C99'];
/** Accessible data table complements hover/keyboard inspection of the SVG chart. */
export default function DistributionChart({ data, label, donut = false }: { data: DistributionItem[]; label: string; donut?: boolean }) {
  const values = data.map(item => ({ name: item.value ?? 'Sin valor indicado', count: item.count }));
  const height = donut ? 260 : Math.max(260, values.length * 30 + 32);
  if (!values.length || values.every(item => item.count === 0)) return <EmptyState compact icon={ChartNoAxesCombined} title="Sin datos para este gráfico" description="No hay registros aplicables en el resumen consultado." />;
  const tooltip = <Tooltip contentStyle={{ background: '#162235', border: '1px solid #3B506B', borderRadius: 7, color: '#E8EEF5', fontSize: 14 }} itemStyle={{ color: '#E8EEF5' }} cursor={{ fill: '#26364B', fillOpacity: 0.35 }} formatter={value => [Number(value).toLocaleString('es-PA'), 'Eventos']} />;
  return <figure className="dashboard-distribution" aria-label={label}>
    <div className="dashboard-plot" style={{ height }}><ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 600, height }}>
      {donut ? <PieChart accessibilityLayer>{tooltip}<Pie data={values} dataKey="count" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2} stroke="#162235" isAnimationActive={false}>{values.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}</Pie></PieChart>
        : <BarChart data={values} layout="vertical" accessibilityLayer margin={{ top: 8, right: 28, bottom: 8, left: 5 }}>
          <CartesianGrid stroke="#26364B" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fill: '#B5C7DE', fontSize: 13 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#C5D2E2', fontSize: 13 }} axisLine={false} tickLine={false} />{tooltip}<Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>}
    </ResponsiveContainer></div>
    {donut && <ul className="dashboard-chart-legend">{values.map((item, index) => <li key={item.name}><i style={{ backgroundColor: palette[index % palette.length] }} aria-hidden="true" /><span>{item.name}</span><strong>{item.count.toLocaleString('es-PA')}</strong></li>)}</ul>}
    <details className="dashboard-chart-table"><summary>Ver datos de {label.toLowerCase()}</summary><table><caption className="sr-only">{label}</caption><thead><tr><th scope="col">Categoría</th><th scope="col">Eventos</th></tr></thead><tbody>{values.map(item => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count.toLocaleString('es-PA')}</td></tr>)}</tbody></table></details>
  </figure>;
}
