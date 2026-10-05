'use client';
import Link from 'next/link';
import { Card, Chip } from '@dbl/ui';
import { ApiError } from '@/lib/api';
import { useOp } from '@/lib/hooks';
import { fmtDate } from '@/components/DataTable';

const forbidden = (q: { error: unknown }) => q.error instanceof ApiError && q.error.status === 403;
/** "Needs attention" strip on Today. A list the user may not see is simply omitted, never shown as an error. */
export function Attention() {
  const tasks = useOp('listTasks'); const incidents = useOp('listIncidents'); const quals = useOp('listQualifications', { query: { withinDays: 30 } });
  const openTasks = ((tasks.data as any[]) ?? []).filter((t) => t.status !== 'done').slice(0, 5);
  const openInc = ((incidents.data as any[]) ?? []).filter((i) => i.status !== 'resolved').slice(0, 5);
  const expiring = ((quals.data as any[]) ?? []).slice(0, 5);
  const cards = [
    !forbidden(tasks) && { key: 'tasks', title: 'My open tasks', href: '/jobs', empty: 'Nothing open.', items: openTasks.map((t) => ({ id: t.id, text: t.title, chip: t.due_at ? <Chip tone="hold">due {fmtDate(t.due_at)}</Chip> : null })) },
    !forbidden(incidents) && { key: 'inc', title: 'Open incidents', href: '/quality', empty: 'No open incidents.', items: openInc.map((i) => ({ id: i.id, text: `${i.ref} · ${i.kind.replace('_', ' ')}`, chip: <Chip tone={i.severity === 'high' ? 'stop' : 'hold'}>{i.severity}</Chip> })) },
    !forbidden(quals) && { key: 'quals', title: 'Qualifications expiring (30 days)', href: '/people', empty: 'None expiring.', items: expiring.map((x) => ({ id: x.id, text: `${x.full_name} · ${x.kind.replace('_', ' ')}`, chip: <Chip tone={x.expired ? 'stop' : 'hold'}>{x.expired ? 'expired' : `${x.days_left}d left`}</Chip> })) }]
    .filter(Boolean) as Array<{ key: string; title: string; href: string; empty: string; items: Array<{ id: string; text: string; chip: React.ReactNode }> }>;
  if (!cards.length) return null;
  return <section aria-label="Needs attention" className="grid grid-cols-1 md:grid-cols-3 gap-4">{cards.map((c) => <Card key={c.key} title={c.title} actions={<Link href={c.href} className="text-xs underline">Open</Link>}>
    {c.items.length ? <ul className="divide-y divide-line">{c.items.map((i) => <li key={i.id} className="flex items-center gap-2 py-2 text-sm"><span className="flex-1">{i.text}</span>{i.chip}</li>)}</ul> : <p className="text-sm text-steel">{c.empty}</p>}</Card>)}</section>;
}
