'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd } from '@/lib/hooks';
import { ErrorNote, PageTitle } from '@/components/bits';
import { AreaField, FormGrid, SelectField, TextField } from '@/components/fields';
import { Only } from '@/components/Common';

const MODES = [['ocean_fcl', 'Ocean — full container'], ['ocean_lcl', 'Ocean — part container'], ['air', 'Air freight'], ['road', 'Road freight'], ['multimodal', 'Multimodal']] as const;
export default function RequestQuote() {
  const create = useCmd('createEnquiry', { invalidate: ['listEnquiries'] }); const [sent, setSent] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<any>({ defaultValues: { mode: 'ocean_fcl' } });
  return (<Only workspaces={['customer']}><PageTitle title="Request a quote" sub="Tell us what you need to move" />
    {sent ? <Card><div className="grid gap-3"><Chip tone="ok">Request {sent} received</Chip><p className="text-sm">Our team will review it and send you a quotation. You can follow it under <Link href="/quotes" className="underline">Quotes</Link>.</p><div className="flex gap-3"><Button onClick={() => { setSent(null); reset({ mode: 'ocean_fcl' }); }}>Request another</Button></div></div></Card>
      : <Card><form className="grid max-w-2xl gap-4" onSubmit={handleSubmit((v) => create.mutate({ body: { mode: v.mode, origin: v.origin, destination: v.destination, ...(v.incoterm ? { incoterm: v.incoterm } : {}), cargo: { commodity: v.commodity, ...(v.weight ? { grossWeightKg: Number(v.weight) } : {}), ...(v.notes ? { notes: v.notes } : {}) } } as any }, { onSuccess: (e: any) => setSent(e.ref) } as any))}>
        <SelectField label="Mode" {...register('mode')}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        <FormGrid><TextField label="From (city / port)" error={errors.origin && 'Required'} {...register('origin', { required: true, minLength: 2 })} /><TextField label="To (city / port)" error={errors.destination && 'Required'} {...register('destination', { required: true, minLength: 2 })} /></FormGrid>
        <FormGrid cols={3}><TextField label="Commodity" error={errors.commodity && 'Required'} {...register('commodity', { required: true })} /><TextField label="Gross weight (kg)" inputMode="decimal" {...register('weight')} /><TextField label="Incoterm" maxLength={3} placeholder="FOB" {...register('incoterm')} /></FormGrid>
        <AreaField label="Anything else we should know?" {...register('notes')} /><div><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Sending…' : 'Send request'}</Button></div><ErrorNote e={create.error} /></form></Card>}</Only>);
}
