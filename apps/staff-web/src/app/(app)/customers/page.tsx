'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreatePartyBody } from '@dbl/contracts';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle } from '@/components/bits';
import { DataTable, RefLink } from '@/components/DataTable';
import { FormGrid, SelectField, TextField } from '@/components/fields';

type P = { id: string; legal_name: string; trading_name?: string; tax_registration_number?: string; country?: string; status: string; roles: string[] };
const col = createColumnHelper<P>();
const ROLES = ['customer', 'supplier', 'carrier', 'transporter', 'agent', 'shipper', 'consignee', 'insurer', 'broker'] as const;
const Form = CreatePartyBody.omit({ roles: true }).extend({ role: z.enum(ROLES) });
export default function Customers() {
  const q = useOp('listParties'); const create = useCmd('createParty', { invalidate: ['listParties'] });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.input<typeof Form>>({ resolver: zodResolver(Form), defaultValues: { role: 'customer' } });
  const columns = useMemo(() => [
    col.accessor('legal_name', { header: 'Party', cell: (c) => <RefLink href={`/customers/${c.row.original.id}`}>{c.getValue()}</RefLink> }),
    col.accessor('roles', { header: 'Roles', cell: (c) => <span className="flex flex-wrap gap-1">{c.getValue().map((r) => <Chip key={r} tone={r === 'customer' ? 'info' : 'idle'}>{r}</Chip>)}</span>, filterFn: 'includesString' }),
    col.accessor('tax_registration_number', { header: 'Tax reg. no.', cell: (c) => <span className="font-mono text-xs">{c.getValue() ?? '—'}</span> }),
    col.accessor('country', { header: 'Country', cell: (c) => c.getValue() ?? '—' }),
    col.accessor('status', { header: 'Status', cell: (c) => <Chip tone={c.getValue() === 'active' ? 'ok' : 'stop'}>{c.getValue()}</Chip> }),
  ], []);
  return (<>
    <PageTitle title="Customers & partners" sub="Commercial · one identity, many roles" />
    <div className="grid grid-cols-[1fr_340px] items-start gap-5">
      <Card title="Parties"><DataTable q={q} columns={columns} empty="No parties yet — create the first on the right." label="Filter parties" /></Card>
      <Card title="New party"><form className="grid gap-3" onSubmit={handleSubmit(({ role, ...b }) => create.mutate({ body: { ...b, roles: [role] } as any }, { onSuccess: () => reset() } as any))}>
        <TextField label="Legal name" error={errors.legalName?.message} {...register('legalName')} />
        <FormGrid><TextField label="Tax reg. no." {...register('taxRegistrationNumber')} /><TextField label="Country (ISO-2)" maxLength={2} {...register('country')} /></FormGrid>
        <SelectField label="Primary role" {...register('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</SelectField>
        <Button type="submit" disabled={create.isPending}>Create party</Button><ErrorNote e={create.error} /></form></Card>
    </div></>);
}
