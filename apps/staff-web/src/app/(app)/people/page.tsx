'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDate } from '@/components/DataTable';
import { EmployeePicker, EntityPicker, FormGrid, SelectField, TextField } from '@/components/fields';
import { SectionTabs } from '@/components/SectionTabs';

const KINDS = ['forklift', 'dg_handling', 'driving', 'customs_broker', 'first_aid', 'reefer_handling'] as const;
const AK = ['forklift', 'scanner', 'reefer_unit', 'vehicle', 'temperature_logger'] as const;
type E = { id: string; full_name: string; job_title?: string; department?: string; status: string; hired_on?: string; qualifications: Array<{ kind: string; valid_to: string; valid: boolean }> };
type Q = { id: string; kind: string; reference?: string; issued_on: string; valid_to: string; expired: boolean; days_left: number; employee_id: string; full_name: string };
type A = { id: string; kind: string; code: string; status: string; next_service_due?: string; calibration_due?: string; facility?: string };
const ec = createColumnHelper<E>(), qc = createColumnHelper<Q>(), ac = createColumnHelper<A>();

function Employees() {
  const q = useOp('listEmployees'); const create = useCmd('createEmployee', { invalidate: ['listEmployees'] }); const addQ = useCmd('addQualification', { invalidate: ['listEmployees', 'listQualifications'] });
  const f = useForm<any>(); const g = useForm<any>({ defaultValues: { kind: 'driving' } });
  const columns = useMemo(() => [ec.accessor('full_name', { header: 'Employee', cell: (c) => <b className="font-display">{c.getValue()}</b> }), ec.accessor('job_title', { header: 'Role', cell: (c) => c.getValue() ?? '—' }), ec.accessor('department', { header: 'Dept.', cell: (c) => c.getValue() ?? '—' }),
    ec.accessor('qualifications', { header: 'Qualifications', enableSorting: false, cell: (c) => <span className="flex flex-wrap gap-1">{c.getValue().length ? c.getValue().map((x) => <Chip key={x.kind} tone={x.valid ? 'ok' : 'stop'}>{x.kind.replace('_', ' ')}{!x.valid && ' · expired'}</Chip>) : <span className="text-xs text-steel">none</span>}</span> }), ec.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> })], []);
  return (<div className="grid grid-cols-[1fr_340px] items-start gap-5">
    <Card title="Employees"><DataTable q={q} columns={columns} empty="No employees yet." label="Filter employees" /></Card>
    <div className="grid gap-5">
      <Card title="Add employee"><form className="grid gap-3" onSubmit={f.handleSubmit((b) => create.mutate({ body: b }, { onSuccess: () => f.reset() } as any))}>
        <EntityPicker label="Legal entity" {...f.register('legalEntityId', { required: true })} />
        <TextField label="Full name" {...f.register('fullName', { required: true })} /><FormGrid><TextField label="Job title" {...f.register('jobTitle')} /><TextField label="Department" {...f.register('department')} /></FormGrid>
        <Button type="submit" disabled={create.isPending}>Add employee</Button><ErrorNote e={create.error} /></form></Card>
      <Card title="Record qualification"><form className="grid gap-3" onSubmit={g.handleSubmit(({ employeeId, ...b }) => addQ.mutate({ params: { id: employeeId }, body: b }, { onSuccess: () => g.reset({ kind: 'driving' }) } as any))}>
        <EmployeePicker label="Employee" {...g.register('employeeId', { required: true })} />
        <SelectField label="Kind" {...g.register('kind')}>{KINDS.map((k) => <option key={k}>{k}</option>)}</SelectField><TextField label="Certificate no." {...g.register('reference')} />
        <FormGrid><TextField label="Issued" type="date" {...g.register('issuedOn', { required: true })} /><TextField label="Valid to" type="date" {...g.register('validTo', { required: true })} /></FormGrid>
        <Button type="submit" variant="ghost" disabled={addQ.isPending}>Record</Button><ErrorNote e={addQ.error} /></form></Card></div></div>);
}
function Qualifications() {
  const q = useOp('listQualifications', { query: { withinDays: 90 } });
  const columns = useMemo(() => [qc.accessor('full_name', { header: 'Employee' }), qc.accessor('kind', { header: 'Qualification', cell: (c) => c.getValue().replace('_', ' ') }), qc.accessor('reference', { header: 'Certificate', cell: (c) => <Mono>{c.getValue() ?? '—'}</Mono> }), qc.accessor('valid_to', { header: 'Valid to', cell: (c) => fmtDate(c.getValue()) }),
    qc.accessor('days_left', { header: 'Status', cell: (c) => c.row.original.expired ? <Chip tone="stop">expired</Chip> : <Chip tone={c.getValue() <= 30 ? 'hold' : 'ok'}>{c.getValue()} days left</Chip> })], []);
  return <Card title="Expiring within 90 days"><DataTable q={q} columns={columns} empty="Nothing expires in the next 90 days." label="Filter qualifications" /></Card>;
}
function Assets() {
  const q = useOp('listAssets'); const create = useCmd('createAsset', { invalidate: ['listAssets'] }); const f = useForm<any>({ defaultValues: { kind: 'forklift' } });
  const columns = useMemo(() => [ac.accessor('code', { header: 'Asset', cell: (c) => <Mono>{c.getValue()}</Mono> }), ac.accessor('kind', { header: 'Type', cell: (c) => c.getValue().replace('_', ' ') }), ac.accessor('facility', { header: 'Facility', cell: (c) => c.getValue() ?? '—' }), ac.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    ac.accessor('next_service_due', { header: 'Service due', cell: (c) => fmtDate(c.getValue()) }), ac.accessor('calibration_due', { header: 'Calibration due', cell: (c) => fmtDate(c.getValue()) })], []);
  return (<div className="grid grid-cols-[1fr_340px] items-start gap-5"><Card title="Equipment & vehicles"><DataTable q={q} columns={columns} empty="No assets registered." label="Filter assets" /></Card>
    <Card title="Register asset"><form className="grid gap-3" onSubmit={f.handleSubmit((b) => create.mutate({ body: Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '')) as any }, { onSuccess: () => f.reset({ kind: 'forklift' }) } as any))}>
      <SelectField label="Type" {...f.register('kind')}>{AK.map((k) => <option key={k}>{k}</option>)}</SelectField><TextField label="Code" {...f.register('code', { required: true })} />
      <FormGrid><TextField label="Service due" type="date" {...f.register('nextServiceDue')} /><TextField label="Calibration due" type="date" {...f.register('calibrationDue')} /></FormGrid>
      <Button type="submit" disabled={create.isPending}>Register</Button><ErrorNote e={create.error} /></form></Card></div>);
}
export default function People() {
  return (<><PageTitle title="People & assets" sub="Capability records that gate real work — no valid licence, no dispatch" />
    <SectionTabs sections={[{ id: 'employees', label: 'Employees', content: <Employees /> }, { id: 'quals', label: 'Qualifications', content: <Qualifications /> }, { id: 'assets', label: 'Assets', content: <Assets /> }]} /></>);
}
