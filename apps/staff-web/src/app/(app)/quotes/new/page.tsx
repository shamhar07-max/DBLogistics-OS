'use client';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { D, MoneyString, QuoteLineIn, roundMoney, taxFor } from '@dbl/contracts';
import { Button, Card } from '@dbl/ui';
import { useCmd, useOp, money } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, inputCls } from '@/components/bits';

const Form = z.object({ legalEntityId: z.string().uuid('Select an entity'), customerPartyId: z.string().uuid('Select a customer'), currency: z.string().length(3), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.string(), origin: z.string().min(2), destination: z.string().min(2), incoterm: z.string().optional(), lines: z.array(QuoteLineIn.extend({ quantity: MoneyString, unitPrice: MoneyString, expectedUnitCost: MoneyString })).min(1) });
type F = z.input<typeof Form>;
const blank = { description: '', chargeType: 'fixed', chargeGroup: 'main', quantity: '1', unit: 'shipment', unitPrice: '0', expectedUnitCost: '0', taxCode: 'SR5' } as const;

/** Quote builder: live totals use the SAME decimal rules (half-up per line) as the server, so what you see is what is stored. */
export default function NewQuote() {
  const router = useRouter(); const le = useOp('listLegalEntities'); const parties = useOp('listParties'); const create = useCmd('createQuote', { onSuccess: () => router.push('/quotes') });
  const { register, control, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(Form), defaultValues: { currency: 'AED', mode: 'ocean_fcl', validUntil: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), lines: [blank as any] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' }); const lines = useWatch({ control, name: 'lines' }) ?? [];
  const t = lines.reduce((a, l) => { try { const n = roundMoney(D(l.quantity || '0').mul(l.unitPrice || '0')); return { net: a.net.plus(n), tax: a.tax.plus(taxFor(n, l.taxCode ?? 'SR5')), cost: a.cost.plus(roundMoney(D(l.quantity || '0').mul(l.expectedUnitCost || '0'))) }; } catch { return a; } }, { net: D(0), tax: D(0), cost: D(0) });
  const margin = t.net.isZero() ? null : t.net.minus(t.cost).div(t.net).mul(100).toFixed(1);
  return (<><PageTitle title="New quotation" sub="Commercial · quote builder" />
    <form onSubmit={handleSubmit((v) => create.mutate({ body: v as any }))} className="grid grid-cols-[1fr_320px] gap-5">
      <Card title="Route & parties"><div className="grid grid-cols-2 gap-3">
        <Field label="Legal entity" error={errors.legalEntityId?.message}><select className={inputCls} {...register('legalEntityId')}><option value="">Select…</option>{((le.data as any[]) ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Customer" error={errors.customerPartyId?.message}><select className={inputCls} {...register('customerPartyId')}><option value="">Select…</option>{((parties.data as any[]) ?? []).map((p) => <option key={p.id} value={p.id}>{p.legal_name}</option>)}</select></Field>
        <Field label="Origin" error={errors.origin?.message}><input className={inputCls} {...register('origin')} /></Field><Field label="Destination" error={errors.destination?.message}><input className={inputCls} {...register('destination')} /></Field>
        <Field label="Valid until"><input type="date" className={inputCls} {...register('validUntil')} /></Field><Field label="Incoterm"><input className={inputCls} placeholder="FOB" {...register('incoterm')} /></Field></div>
        <h3 className="mb-2 mt-6 font-display text-sm font-semibold">Charges</h3>
        {fields.map((f, i) => <div key={f.id} className="mb-3 grid grid-cols-[2fr_1fr_.7fr_1fr_1fr_.8fr_auto] items-end gap-2">
          <Field label="Description" error={errors.lines?.[i]?.description?.message}><input className={inputCls} {...register(`lines.${i}.description`)} /></Field>
          <Field label="Type"><select className={inputCls} {...register(`lines.${i}.chargeType`)}>{['fixed', 'estimated', 'at_cost', 'conditional'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Qty" error={errors.lines?.[i]?.quantity?.message}><input className={inputCls + ' font-mono'} {...register(`lines.${i}.quantity`)} /></Field>
          <Field label="Unit price" error={errors.lines?.[i]?.unitPrice?.message}><input className={inputCls + ' font-mono'} {...register(`lines.${i}.unitPrice`)} /></Field>
          <Field label="Expected cost"><input className={inputCls + ' font-mono'} {...register(`lines.${i}.expectedUnitCost`)} /></Field>
          <Field label="Tax"><select className={inputCls} {...register(`lines.${i}.taxCode`)}>{['SR5', 'ZR', 'EX', 'OOS'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Remove line">✕</Button></div>)}
        <Button type="button" size="sm" variant="ghost" onClick={() => append(blank as any)}>+ Add charge</Button></Card>
      <Card title="Totals" cast><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Net</dt><dd className="font-mono">{money(t.net.toFixed(2))}</dd></div><div className="flex justify-between"><dt>Tax</dt><dd className="font-mono">{money(t.tax.toFixed(2))}</dd></div><div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd className="font-mono">{money(t.net.plus(t.tax).toFixed(2))}</dd></div></dl>
        <div className="mt-4 rounded-sm bg-paper p-3 text-xs"><b>Internal</b> · expected margin {margin ?? '—'}% <span className="text-steel">(never shown to customers)</span></div>
        <Button className="mt-4 w-full justify-center" variant="signal" type="submit" disabled={create.isPending}>Save draft</Button><ErrorNote e={create.error} /></Card>
    </form></>);
}
