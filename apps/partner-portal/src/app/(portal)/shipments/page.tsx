'use client';
import { Card } from '@dbl/ui';
import { PageTitle } from '@/components/bits';
import { Only, ShipmentsTable } from '@/components/Common';

export default function Shipments() {
  return (<Only workspaces={['customer', 'agent', 'transporter', 'driver']}><PageTitle title="Shipments" sub="Everything moving for you" /><Card><ShipmentsTable /></Card></Only>);
}
