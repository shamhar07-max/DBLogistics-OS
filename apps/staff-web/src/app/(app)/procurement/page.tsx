'use client';
import { useState } from 'react';
import { Button, Card, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { AreaField, EntityPicker, FormGrid, SelectField, TextField } from '@/components/fields';

const value = (form: FormData, name: string) => String(form.get(name) ?? '');
const modes = ['ocean_fcl','ocean_lcl','air','road','multimodal','warehouse','customs'] as const;
export default function Procurement() {
  const q=useOp('listRfqs'), parties=useOp('listParties'), me=useOp('getMe');
  const [selected,setSelected]=useState('');
  const manage=((me.data as any)?.permissions ?? []).includes('rates.manage');
  const create=useCmd('createRfq',{invalidate:['listRfqs'],onSuccess:r=>setSelected(r.id)});
  const suppliers=((parties.data as any[])??[]).filter(p=>p.status==='active' && p.roles.some((role:string)=>['supplier','carrier','agent'].includes(role)));
  return <>
    <PageTitle title="Rate procurement" sub="Invite suppliers, compare their latest responses, and award with an independent reviewer." />
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card title="Rate requests"><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!((q.data as any[])??[]).length} empty="No rate requests yet.">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line text-steel"><th className="p-2">Request</th><th className="p-2">Lane</th><th className="p-2">Status</th><th className="p-2">Responses</th></tr></thead><tbody>{((q.data as any[])??[]).map(r=><tr key={r.id} className="border-b border-line"><td className="p-2"><button className="font-mono font-semibold underline" onClick={()=>setSelected(r.id)} aria-pressed={selected===r.id}>{r.ref}</button></td><td className="p-2">{r.origin} → {r.destination}</td><td className="p-2"><StatusChip s={r.status}/></td><td className="p-2">{r.response_count}</td></tr>)}</tbody></table></div>
      </QueryBoundary></Card>
      {manage && <Card title="New rate request"><form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);create.mutate({body:{legalEntityId:value(f,'entity'),mode:value(f,'mode') as typeof modes[number],origin:value(f,'origin'),destination:value(f,'destination'),requirements:value(f,'requirements'),currency:value(f,'currency'),responseDeadline:new Date(value(f,'deadline')).toISOString(),supplierPartyIds:f.getAll('suppliers').map(String)}});}}>
        <EntityPicker label="Legal entity" name="entity" required/>
        <SelectField label="Mode" name="mode">{modes.map(m=><option key={m} value={m}>{m.replace('_',' ')}</option>)}</SelectField>
        <TextField label="Origin" name="origin" required minLength={2} maxLength={200}/><TextField label="Destination" name="destination" required minLength={2} maxLength={200}/>
        <AreaField label="Cargo, inclusions and required service" name="requirements" required minLength={10} maxLength={10000}/>
        <TextField label="Comparison currency" name="currency" defaultValue="AED" required pattern="[A-Z]{3}" maxLength={3}/>
        <TextField label="Response deadline (your local time)" name="deadline" type="datetime-local" required/>
        <SelectField label="Invited suppliers (select one or more)" name="suppliers" multiple required size={Math.min(6,Math.max(2,suppliers.length))}>{suppliers.map(p=><option key={p.id} value={p.id}>{p.legal_name}</option>)}</SelectField>
        <p className="text-xs text-steel">All responses use the comparison currency. An issued request is immutable. Distribution to suppliers is manual.</p>
        <Button type="submit" disabled={create.isPending}>Prepare request</Button><ErrorNote e={create.error}/>
      </form></Card>}
    </div>
    {selected && <RfqDetail key={selected} id={selected} manage={manage} userId={(me.data as any)?.userId}/>}
  </>;
}
function RfqDetail({id,manage,userId}:{id:string;manage:boolean;userId?:string}) {
  const q=useOp('getRfq',{params:{id}}); const r=q.data as any;
  const options={invalidate:['listRfqs','getRfq'] as ('listRfqs'|'getRfq')[]};
  const issue=useCmd('issueRfq',options), record=useCmd('recordRfqOffer',options), award=useCmd('awardRfq',options);
  const [offerId,setOfferId]=useState('');
  const choices=(r?.comparison??[]).filter((o:any)=>o.eligible);
  const selected=choices.find((o:any)=>o.id===offerId);
  const independent=r?.created_by!==userId && selected?.created_by!==userId;
  return <QueryBoundary status={q.status} error={errView(q.error)}>{r && <>
    <Card title={`${r.ref} · ${r.origin} → ${r.destination}`} actions={<StatusChip s={r.status}/>}>
      <p className="whitespace-pre-wrap text-sm">{r.requirements}</p><p className="mt-2 text-xs text-steel">Currency {r.currency} · deadline {new Date(r.response_deadline).toLocaleString()} · version {r.version}</p>
      {r.status==='draft' && manage && <div className="mt-3"><Button disabled={issue.isPending || !r.accepting_responses} onClick={()=>issue.mutate({params:{id},ifMatch:r.version})}>Issue for manual distribution</Button><ErrorNote e={issue.error}/></div>}
      {r.status==='issued' && <p className="mt-3 text-sm text-steel">Distribute these requirements to the invited suppliers and record each response below. Issuing does not send an email.</p>}
      {r.status==='awarded' && <p className="mt-3 text-sm">Approved rate created. Award reason: {r.award_reason}</p>}
    </Card>
    <Card title="Latest supplier comparison"><p className="mb-3 text-xs text-steel">Valid latest revisions first, then total cost and transit days. Taxes, duties and excluded services follow the supplier’s terms.</p>
      {!r.comparison.length ? <p className="text-sm text-steel">No supplier responses recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line text-steel">{['Supplier','Revision','Total','Transit','Free time','Validity','Terms'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{r.comparison.map((o:any)=><tr key={o.id} className="border-b border-line"><td className="p-2">{o.supplier_name}</td><td className="p-2">{o.revision}</td><td className="p-2 font-mono">{o.total} {r.currency}</td><td className="p-2">{o.transit_days} days</td><td className="p-2">{o.free_days} days</td><td className="p-2">{String(o.valid_until).slice(0,10)}{!o.eligible && ' · expired'}</td><td className="max-w-xs whitespace-pre-wrap p-2">{o.terms}</td></tr>)}</tbody></table></div>}
    </Card>
    {manage && r.status==='issued' && <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <Card title="Record supplier response"><form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);record.mutate({params:{id},body:{supplierPartyId:value(f,'supplier'),freight:value(f,'freight'),localCharges:value(f,'local'),transitDays:Number(value(f,'transit')),freeDays:Number(value(f,'free')),validUntil:value(f,'valid'),terms:value(f,'terms')}});}}>
        <SelectField label="Invited supplier" aria-label="Invited supplier" name="supplier" required><option value="">Select…</option>{r.suppliers.map((s:any)=><option key={s.supplier_party_id} value={s.supplier_party_id}>{s.legal_name}</option>)}</SelectField>
        <FormGrid><TextField label={`Freight (${r.currency})`} name="freight" required inputMode="decimal" pattern="\d+(\.\d{1,4})?"/><TextField label={`Local charges (${r.currency})`} name="local" defaultValue="0" required inputMode="decimal" pattern="\d+(\.\d{1,4})?"/>
        <TextField label="Transit days" name="transit" type="number" min={0} max={3650} step={1} required/><TextField label="Free days" name="free" type="number" min={0} max={3650} step={1} required/></FormGrid>
        <TextField label="Valid until" name="valid" type="date" required/><AreaField label="Inclusions, exclusions and terms" name="terms" required minLength={10} maxLength={10000}/>
        <p className="text-xs text-steel">Recording another response keeps the previous revision in history.</p>
        <Button type="submit" disabled={record.isPending || !r.accepting_responses}>Record response</Button><ErrorNote e={record.error}/>
      </form></Card>
      <Card title="Independent award"><form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);award.mutate({params:{id},ifMatch:r.version,body:{offerId,reason:value(f,'reason')}});}}>
        <SelectField label="Valid latest response" value={offerId} onChange={e=>setOfferId(e.target.value)} required><option value="">Select…</option>{choices.map((o:any)=><option key={o.id} value={o.id}>{o.supplier_name} · {o.total} {r.currency}</option>)}</SelectField>
        <AreaField label="Award justification" name="reason" required minLength={10} maxLength={4000}/>
        <p className="text-sm text-steel">The request author and selected response recorder cannot approve this award. A successful award publishes an approved rate with its source and terms.</p>
        <Button type="submit" disabled={award.isPending || !offerId || !independent}>Award and publish rate</Button><ErrorNote e={award.error}/>
      </form></Card>
    </div>}
    <Card title="Response history"><ul className="grid gap-2 text-sm">{r.history.map((o:any)=><li key={o.id} className="border-b border-line pb-2">{o.supplier_name} · revision {o.revision} · {o.total} {r.currency} · {new Date(o.created_at).toLocaleString()}{o.latest ? ' · latest' : ' · superseded'}<p className="whitespace-pre-wrap text-xs text-steel">{o.terms}</p></li>)}</ul></Card>
  </>}</QueryBoundary>;
}
