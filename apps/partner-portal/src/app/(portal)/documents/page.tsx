'use client';
import { useState } from 'react';
import { Card } from '@dbl/ui';
import { useOp } from '@/lib/hooks';
import { PageTitle } from '@/components/bits';
import { SelectField } from '@/components/fields';
import { DocumentsTable, Only } from '@/components/Common';
import { isTransporter, useWho } from '@/components/Me';
import { UploadDocument } from '@/components/UploadDocument';

export default function Documents() {
  const { me } = useWho(); const ships = useOp('listShipments'); const [target, setTarget] = useState('');
  return (<Only workspaces={['customer', 'agent', 'transporter', 'driver']}><PageTitle title="Documents" sub="Files for your shipments" />
    <Card title="Library"><DocumentsTable /></Card>
    <Card title="Upload a document"><div className="grid max-w-md gap-3"><SelectField label="Attach to shipment" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select…</option>{((ships.data as any[]) ?? []).map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.origin} → {s.destination}</option>)}</SelectField>
      {target ? <UploadDocument relatedType="shipment" relatedId={target} defaultType={isTransporter(me?.workspace) ? 'Proof of delivery' : undefined} /> : <p className="text-sm text-steel">Choose a shipment first. Files are scanned for malware and reviewed before they are used.</p>}</div></Card></Only>);
}
