'use client';
import { Card } from '@dbl/ui';
import { PageTitle } from '@/components/bits';
import { useWho } from '@/components/Me';

const PLAIN: Record<string, string> = { 'jobs.view': 'See your jobs', 'shipments.view': 'See shipments', 'documents.view': 'View documents', 'documents.upload': 'Upload documents', 'invoices.view': 'View invoices', 'quotes.view': 'View quotations', 'quotes.accept': 'Accept quotations', 'enquiries.view': 'See your quote requests', 'enquiries.create': 'Request quotes', 'shipments.events.record': 'Report shipment milestones', 'transport.view': 'See your trips', 'transport.pod.capture': 'Capture proof of delivery' };
export default function Account() {
  const { me } = useWho();
  return (<><PageTitle title="Account" sub="Who you are signed in as" />{me && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Profile"><dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm"><dt className="text-steel">Company</dt><dd data-testid="account-company">{me.partyName ?? '—'}</dd><dt className="text-steel">Email</dt><dd>{me.email ?? '—'}</dd><dt className="text-steel">Portal</dt><dd className="capitalize">{me.workspace}</dd></dl></Card>
    <Card title="What you can do"><ul className="grid gap-1 text-sm">{me.permissions.filter((p) => PLAIN[p]).map((p) => <li key={p}>✓ {PLAIN[p]}</li>)}</ul><p className="mt-3 text-xs text-steel">You only ever see records that belong to your company. To change access, contact your DigitalBurj account manager.</p></Card></div>}</>);
}
