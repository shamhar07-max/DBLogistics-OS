'use client';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { BankChangeBody } from '@dbl/contracts';
import { Button, Card, Chip, Kpi, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { fmtDate } from '@/components/DataTable';
import { FormGrid, TextField } from '@/components/fields';

export default function PartyDetail() {
  const { id } = useParams<{ id: string }>(); const q = useOp('getParty', { params: { id } }); const p = q.data as any;
  const propose = useCmd('proposeBankChange', { invalidate: ['getParty', 'listBankChanges'] }); const approve = useCmd('approveBankChange', { invalidate: ['getParty', 'listBankChanges'] });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.input<typeof BankChangeBody>>({ resolver: zodResolver(BankChangeBody), defaultValues: { currency: 'AED' } });
  return (<>
    <PageTitle title={p?.legal_name ?? 'Party'} sub="Customer 360">{p && <div className="flex gap-1.5">{p.roles.map((r: string) => <Chip key={r} tone="info">{r}</Chip>)}</div>}</PageTitle>
    <QueryBoundary status={q.status} error={errView(q.error)}>{p && <>
      <section className="grid grid-cols-4 gap-4"><Kpi label="Active jobs" value={p.work.active_jobs} hint={`${p.work.jobs} jobs in total`} /><Kpi label="Open quotes" value={p.work.open_quotes} /><Kpi label="Outstanding" value={money(p.work.outstanding)} /><Kpi label="Overdue" value={money(p.work.overdue)} tone={Number(p.work.overdue) > 0 ? 'risk' : undefined} /></section>
      <div className="grid grid-cols-2 gap-5">
        <Card title="Registration"><dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm"><dt className="text-steel">Tax reg. no.</dt><dd className="font-mono">{p.tax_registration_number ?? '—'}</dd><dt className="text-steel">Country</dt><dd>{p.country ?? '—'}</dd><dt className="text-steel">Status</dt><dd><StatusChip s={p.status} /></dd><dt className="text-steel">Credit limit</dt><dd>{p.credit_limit ? money(p.credit_limit, p.credit_currency ?? 'AED') : 'Not set'}</dd></dl>
          <h4 className="mb-2 mt-5 font-display text-sm font-semibold">Contacts</h4>{p.contacts.length ? p.contacts.map((c: any) => <div key={c.id} className="text-sm">{c.name} · {c.email ?? c.phone}</div>) : <p className="text-sm text-steel">No contacts recorded.</p>}</Card>
        <Card title="Bank details · maker-checker">
          {p.bankDetails.length ? <table className="mb-4 w-full text-sm"><tbody>{p.bankDetails.map((b: any) => <tr key={b.id} className="border-b border-line"><td className="py-2">{b.account_name}</td><td className="font-mono text-xs">{b.iban}</td><td>{b.currency}</td><td>{b.active_to ? <Chip tone="idle">until {fmtDate(b.active_to)}</Chip> : <Chip tone="ok">active</Chip>}</td></tr>)}</tbody></table> : <p className="mb-4 text-sm text-steel">No approved bank details.</p>}
          {p.bankChanges.filter((c: any) => c.status === 'proposed').map((c: any) => <div key={c.id} className="mb-3 flex items-center gap-3 rounded-sm bg-status-hold-100 p-3 text-sm"><div className="flex-1"><b>Proposed change</b> · {c.proposed.accountName} · <span className="font-mono text-xs">{c.proposed.iban}</span></div><Button size="sm" onClick={() => approve.mutate({ params: { id: c.id }, body: { callbackVerified: true } })}>Approve after call-back</Button></div>)}
          <form className="grid gap-3 border-t border-line pt-4" onSubmit={handleSubmit((b) => propose.mutate({ params: { id }, body: b }, { onSuccess: () => reset() } as any))}>
            <FormGrid><TextField label="Account name" error={errors.accountName?.message} {...register('accountName')} /><TextField label="IBAN" error={errors.iban?.message} {...register('iban')} /></FormGrid>
            <Button type="submit" variant="ghost" disabled={propose.isPending}>Propose change</Button><p className="text-xs text-steel">A different person must approve, after a verified call-back.</p></form><ErrorNote e={propose.error ?? approve.error} /></Card>
      </div></>}</QueryBoundary></>);
}
