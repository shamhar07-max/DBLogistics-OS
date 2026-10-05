'use client';
import { useParams } from 'next/navigation';
import { Card, Chip, QueryBoundary, SourceBadge } from '@dbl/ui';
import { useOp, errView } from '@/lib/hooks';
import { PageTitle, StatusChip } from '@/components/bits';

export default function Tracking() {
  const { id } = useParams<{ id: string }>(); const job = useOp('getJob', { params: { id } }); const j = job.data as any; const s = j?.shipments?.[0];
  const tl = useOp('getShipmentTimeline', { params: { id: s?.id ?? '' }, enabled: !!s }); const d = tl.data as any;
  return (<><PageTitle title={j?.ref ?? 'Shipment'} sub="Tracking">{j && <StatusChip s={j.status} />}</PageTitle>
    <QueryBoundary status={job.status} error={errView(job.error)}>
      <Card title="Tracking" actions={d && <Chip tone="info">current: {d.currentMilestone ?? '—'}</Chip>}>{!s ? <p className="text-sm text-steel">No shipment yet.</p> : <ol className="space-y-2">{d?.events.map((e: any, i: number) => <li key={i} className="flex items-center gap-3 text-sm"><span className="w-44 font-mono text-xs text-steel">{new Date(e.event_time).toLocaleString()}</span><b className="font-display">{e.code}</b><SourceBadge source={e.source} actual={e.is_actual} /></li>)}</ol>}</Card>
    </QueryBoundary></>);
}
