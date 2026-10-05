'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDateTime } from '@/components/DataTable';
import { EntityPicker, FormGrid, PartyPicker, SelectField, TextField } from '@/components/fields';
import { SectionTabs } from '@/components/SectionTabs';

type M = { id: string; workspace: string; status: string; subject: string; email?: string; display_name?: string; roles: Array<{ role: string; name: string }> };
type A = { id: string; at: string; action: string; entity_type: string; entity_id: string; actor?: string; actor_kind: string; request_id?: string };
const mc = createColumnHelper<M>(), ac = createColumnHelper<A>();
function Members() {
  const q = useOp('listMembers'); const roles = useOp('listRoles'); const add = useCmd('addMember', { invalidate: ['listMembers', 'listRoles'] }); const f = useForm<any>({ defaultValues: { workspace: 'staff' } }); const ws = f.watch('workspace');
  const columns = useMemo(() => [mc.accessor((r) => r.display_name ?? r.subject, { id: 'n', header: 'Member', cell: (c) => <span><b className="font-display">{c.getValue()}</b><br /><span className="text-xs text-steel">{c.row.original.email ?? c.row.original.subject}</span></span> }), mc.accessor('workspace', { header: 'Workspace', cell: (c) => <Chip tone="info">{c.getValue()}</Chip> }),
    mc.accessor('roles', { header: 'Roles', enableSorting: false, cell: (c) => <span className="flex flex-wrap gap-1">{c.getValue().map((r) => <Chip key={r.role} tone="idle">{r.name}</Chip>)}</span> }), mc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> })], []);
  return (<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] items-start gap-5"><Card title="Members"><DataTable q={q} columns={columns} empty="No members." label="Filter members" /></Card>
    <Card title="Add member"><form className="grid gap-3" onSubmit={f.handleSubmit(({ partyId, email, ...b }) => add.mutate({ body: { ...b, ...(email ? { email } : {}), ...(partyId ? { partyId } : {}) } }, { onSuccess: () => f.reset({ workspace: 'staff' }) } as any))}>
      <TextField label="Login subject" {...f.register('subject', { required: true })} /><TextField label="Email" type="email" {...f.register('email')} />
      <FormGrid><SelectField label="Workspace" {...f.register('workspace')}>{['staff', 'customer', 'agent', 'transporter', 'driver', 'warehouse'].map((w) => <option key={w}>{w}</option>)}</SelectField>
        <SelectField label="Role template" {...f.register('role', { required: true })}><option value="">Select…</option>{((roles.data as any[]) ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</SelectField></FormGrid>
      {ws !== 'staff' && <PartyPicker label="Linked party (required for external)" {...f.register('partyId')} />}
      <Button type="submit" disabled={add.isPending}>Add member</Button><ErrorNote e={add.error} /></form></Card></div>);
}
function Roles() {
  const q = useOp('listRoles'); const rows = (q.data as Array<{ id: string; key: string; name: string; permissions: string[]; members: number }>) ?? [];
  return <QueryBoundary status={q.status} error={errView(q.error)}><div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{rows.map((r) => <Card key={r.id} title={`${r.name} · ${r.members} member${r.members === 1 ? '' : 's'}`}><div className="flex flex-wrap gap-1">{r.permissions.map((p) => <span key={p} className="rounded-sm bg-paper px-1.5 py-0.5 font-mono text-[11px]">{p}</span>)}</div></Card>)}</div></QueryBoundary>;
}
function Audit() {
  const q = useOp('listAuditEvents', { query: { limit: 200 } });
  const columns = useMemo(() => [ac.accessor('at', { header: 'When', cell: (c) => fmtDateTime(c.getValue()) }), ac.accessor('actor', { header: 'Actor', cell: (c) => c.getValue() ?? c.row.original.actor_kind }), ac.accessor('action', { header: 'Action', cell: (c) => <Mono>{c.getValue()}</Mono> }),
    ac.accessor('entity_type', { header: 'Entity' }), ac.accessor('entity_id', { header: 'ID', cell: (c) => <Mono>{c.getValue().slice(0, 8)}</Mono> })], []);
  return <Card title="Audit log · append-only"><DataTable q={q} columns={columns} empty="No audit events." label="Filter audit log" /></Card>;
}
function Integrations() {
  const q = useOp('listIntegrations'); const d = q.data as any;
  return (<QueryBoundary status={q.status} error={errView(q.error)}>{d && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Connections">{d.connections.length ? <ul className="grid gap-2">{d.connections.map((c: any) => <li key={c.id} className="flex items-center gap-2 text-sm"><b className="font-display">{c.provider}</b><span className="text-steel">{c.capability}</span><StatusChip s={c.status} /><span className="ml-auto text-xs text-steel">{c.last_error ?? (c.last_success_at ? fmtDateTime(c.last_success_at) : 'no sync yet')}</span></li>)}</ul> : <p className="text-sm text-steel">No connections configured. Credentials are held in the secret store and never shown here.</p>}</Card>
    <Card title="Inbound webhook inbox">{d.inbox.length ? <ul className="grid gap-1 text-sm">{d.inbox.map((i: any) => <li key={i.provider + i.status} className="flex gap-2"><b className="font-display">{i.provider}</b><StatusChip s={i.status} /><span className="ml-auto font-mono text-xs">{i.n}</span></li>)}</ul> : <p className="text-sm text-steel">No webhooks received.</p>}</Card></div>}</QueryBoundary>);
}
function Facilities() {
  const q = useOp('listFacilities'); const create = useCmd('createFacility', { invalidate: ['listFacilities'] }); const loc = useCmd('createLocation', { invalidate: ['listFacilities'] });
  const f = useForm<any>({ defaultValues: { kind: 'warehouse' } }); const g = useForm<any>(); const rows = (q.data as Array<{ id: string; name: string; kind: string; legal_entity: string; locations: Array<{ id: string; code: string; zone?: string }> }>) ?? [];
  return (<div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]"><Card title="Facilities & storage locations"><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="No facilities yet — create the first one.">
      <ul className="grid gap-3">{rows.map((r) => <li key={r.id} className="rounded-sm border border-line p-3"><div className="flex flex-wrap items-center gap-2"><b className="font-display">{r.name}</b><Chip tone="info">{r.kind}</Chip><span className="text-xs text-steel">{r.legal_entity}</span></div>
        <div className="mt-2 flex flex-wrap gap-1.5">{r.locations.length ? r.locations.map((l) => <span key={l.id} className="rounded-sm bg-paper px-2 py-0.5 font-mono text-xs">{l.code}{l.zone ? ` · ${l.zone}` : ''}</span>) : <span className="text-xs text-steel">No locations yet.</span>}</div></li>)}</ul></QueryBoundary></Card>
    <div className="grid gap-5"><Card title="New facility"><form className="grid gap-3" onSubmit={f.handleSubmit((b) => create.mutate({ body: b }, { onSuccess: () => f.reset({ kind: 'warehouse' }) } as any))}>
      <EntityPicker label="Legal entity" {...f.register('legalEntityId', { required: true })} /><TextField label="Name" {...f.register('name', { required: true, minLength: 2 })} /><SelectField label="Kind" {...f.register('kind')}>{['warehouse', 'yard', 'office', 'cfs'].map((k) => <option key={k}>{k}</option>)}</SelectField><Button type="submit" disabled={create.isPending}>Create facility</Button><ErrorNote e={create.error} /></form></Card>
      <Card title="Add storage location"><form className="grid gap-3" onSubmit={g.handleSubmit(({ facilityId, ...b }) => loc.mutate({ params: { id: facilityId }, body: { code: b.code, ...(b.zone ? { zone: b.zone } : {}) } }, { onSuccess: () => g.reset() } as any))}>
        <SelectField label="Facility" {...g.register('facilityId', { required: true })}><option value="">Select…</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField><FormGrid><TextField label="Code" placeholder="A-01-02" {...g.register('code', { required: true })} /><TextField label="Zone" {...g.register('zone')} /></FormGrid><Button type="submit" variant="ghost" disabled={loc.isPending}>Add location</Button><ErrorNote e={loc.error} /></form></Card></div></div>);
}
export default function Admin() {
  return (<><PageTitle title="Administration" sub="Members, roles, audit and integrations for this tenant" />
    <SectionTabs sections={[{ id: 'members', label: 'Members', content: <Members /> }, { id: 'roles', label: 'Roles', content: <Roles /> }, { id: 'audit', label: 'Audit log', content: <Audit /> }, { id: 'facilities', label: 'Facilities', content: <Facilities /> }, { id: 'integrations', label: 'Integrations', content: <Integrations /> }]} /></>);
}
