'use client';
import { Button, Card, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';

export default function Approvals() {
  const q = useOp('listApprovalRequests'); const ok = useCmd('approveRequest', { invalidate: ['listApprovalRequests'] }); const no = useCmd('rejectRequest', { invalidate: ['listApprovalRequests'] }); const rows = (q.data as any[]) ?? [];
  return (<><PageTitle title="Approvals" sub="Decisions waiting — requesters cannot decide their own" />
    <Card><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="Nothing waiting for a decision."><ul className="divide-y divide-line">{rows.map((a) => <li key={a.id} className="flex items-center gap-4 py-3 text-sm"><div className="flex-1"><b className="font-display">{a.kind}</b><div className="text-steel">{a.summary}</div></div><StatusChip s={a.status} />
      {a.status === 'pending' && <><Button size="sm" variant="ghost" onClick={() => no.mutate({ params: { id: a.id }, body: {} })}>Reject</Button><Button size="sm" onClick={() => ok.mutate({ params: { id: a.id }, body: {} })}>Approve</Button></>}</li>)}</ul></QueryBoundary><ErrorNote e={ok.error ?? no.error} /></Card></>);
}
