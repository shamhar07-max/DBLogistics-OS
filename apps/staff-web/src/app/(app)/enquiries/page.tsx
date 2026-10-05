'use client';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEnquiryBody } from '@dbl/contracts';
import { z } from 'zod';
import { Button, Card, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, StatusChip, inputCls } from '@/components/bits';

const Form = CreateEnquiryBody.extend({ commodity: z.string().optional() });
type F = z.input<typeof Form>;
export default function Enquiries() {
  const q = useOp('listEnquiries'); const le = useOp('listLegalEntities'); const parties = useOp('listParties');
  const create = useCmd('createEnquiry', { invalidate: ['listEnquiries'] }); const qualify = useCmd('qualifyEnquiry', { invalidate: ['listEnquiries'] });
  const { register, handleSubmit, formState: { errors }, reset } = useForm<F>({ resolver: zodResolver(Form), defaultValues: { mode: 'ocean_fcl', source: 'staff', cargo: {} } });
  const rows = (q.data as any[]) ?? [];
  return (<>
    <PageTitle title="Enquiries & quotes" sub="Commercial"><div className="flex items-center gap-3"><Link href="/quotes" className="text-sm underline">All quotes</Link><Link href="/quotes/new"><Button variant="signal">New quote</Button></Link></div></PageTitle>
    <div className="grid grid-cols-[1fr_360px] gap-5">
      <Card title="Intake inbox"><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="No enquiries yet.">
        <table className="w-full text-sm"><tbody>{rows.map((e) => <tr key={e.id} className="border-b border-line"><td className="py-2.5 font-mono font-semibold">{e.ref}</td><td>{e.origin} → {e.destination}</td><td><StatusChip s={e.status} /></td><td className="text-xs text-steel">{(e.missing_information ?? []).length ? `missing: ${e.missing_information.join(', ')}` : ''}</td><td className="text-right"><Button size="sm" variant="ghost" onClick={() => qualify.mutate({ params: { id: e.id } })}>Qualify</Button></td></tr>)}</tbody></table></QueryBoundary><ErrorNote e={qualify.error} /></Card>
      <Card title="New enquiry"><form className="grid gap-3" onSubmit={handleSubmit((v) => { const { commodity, ...b } = v; create.mutate({ body: { ...b, cargo: commodity ? { commodity } : {} } as any }, { onSuccess: () => reset() } as any); })}>
        <Field label="Legal entity" error={errors.legalEntityId?.message}><select className={inputCls} {...register('legalEntityId')}><option value="">Select…</option>{((le.data as any[]) ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Customer" error={errors.customerPartyId?.message}><select className={inputCls} {...register('customerPartyId')}><option value="">Select…</option>{((parties.data as any[]) ?? []).map((p) => <option key={p.id} value={p.id}>{p.legal_name}</option>)}</select></Field>
        <Field label="Mode"><select className={inputCls} {...register('mode')}>{['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal', 'warehouse', 'customs'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Origin" error={errors.origin?.message}><input className={inputCls} {...register('origin')} /></Field><Field label="Destination" error={errors.destination?.message}><input className={inputCls} {...register('destination')} /></Field></div>
        <Field label="Commodity"><input className={inputCls} {...register('commodity')} /></Field>
        <Button type="submit" disabled={create.isPending}>Create enquiry</Button><ErrorNote e={create.error} /></form></Card>
    </div></>);
}
