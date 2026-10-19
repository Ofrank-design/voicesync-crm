import { Card } from "./ui";
export function MetricCard({ label, value, loading }: { label: string; value?: number; loading?: boolean }) {
  return <Card><p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p><p className="mt-1 text-3xl font-semibold" data-testid={`metric-${label}`}>{loading ? "…" : (value ?? 0)}</p></Card>;
}
export function MetricsRow({ stats, loading }: { stats?: { open: number; overdue: number; high_priority: number; due_today: number }; loading?: boolean }) {
  return (
    <section aria-label="Metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard label="Open tasks" value={stats?.open} loading={loading} />
      <MetricCard label="Overdue" value={stats?.overdue} loading={loading} />
      <MetricCard label="High priority" value={stats?.high_priority} loading={loading} />
      <MetricCard label="Due today" value={stats?.due_today} loading={loading} />
    </section>
  );
}
