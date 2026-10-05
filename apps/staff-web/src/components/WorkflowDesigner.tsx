'use client';
import { useMemo, useState } from 'react';
import { EVENT_TOPICS, previewWorkflow, WORKFLOW_LIMITS, WorkflowBody, type WorkflowActionT, type WorkflowConditionT } from '@dbl/contracts';
import { Button, Chip } from '@dbl/ui';
import { useCmd } from '@/lib/hooks';
import { ErrorNote, Field, inputCls } from '@/components/bits';
import { FormGrid, SelectField, TextField } from '@/components/fields';

export interface Draft { key: string; triggerTopic: string; description: string; conditions: WorkflowConditionT[]; actions: Array<WorkflowActionT & { _unit?: 'seconds' | 'minutes' | 'hours' | 'days' }> }
export const emptyDraft = (): Draft => ({ key: '', triggerTopic: 'DeliveryCompleted', description: '', conditions: [], actions: [{ type: 'create_task', title: '' }] });
const UNIT: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
const FIELD_HINTS = ['payload.jobId', 'payload.amount', 'payload.code', 'payload.variance', 'aggregateType', 'topic'];
const OPS = [['eq', 'equals'], ['ne', 'is not'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['contains', 'contains'], ['exists', 'is present']] as const;
const SAMPLE = '{\n  "jobId": "JOB-26-00012",\n  "amount": 500\n}';

/** Turns a stored definition back into an editable draft (for "publish a new version"). */
export function draftFrom(w: { key: string; trigger_topic: string; description?: string | null; definition: any }): Draft {
  return { key: w.key, triggerTopic: w.trigger_topic, description: w.description ?? '', conditions: w.definition.conditions ?? [], actions: (w.definition.actions ?? []).map((a: any) => a.type === 'wait' ? (a.seconds % 86400 === 0 ? { ...a, seconds: a.seconds / 86400, _unit: 'days' } : a.seconds % 3600 === 0 ? { ...a, seconds: a.seconds / 3600, _unit: 'hours' } : a.seconds % 60 === 0 ? { ...a, seconds: a.seconds / 60, _unit: 'minutes' } : { ...a, _unit: 'seconds' }) : a) };
}
const toBody = (d: Draft) => ({ key: d.key, triggerTopic: d.triggerTopic, ...(d.description ? { description: d.description } : {}), definition: { conditions: d.conditions.map((c) => (c.op === 'exists' ? { field: c.field, op: c.op } : { ...c, value: typeof c.value === 'string' && c.value.trim() !== '' && !Number.isNaN(Number(c.value)) ? Number(c.value) : c.value })),
  actions: d.actions.map(({ _unit, ...a }) => (a.type === 'wait' ? { type: 'wait' as const, seconds: Math.round(Number(a.seconds) * UNIT[_unit ?? 'seconds']) } : a.type === 'create_task' && !a.dueInHours ? { type: a.type, title: a.title } : a)) } });

export function WorkflowDesigner({ initial, onClose, locked }: { initial: Draft; onClose: () => void; locked?: boolean }) {
  const [d, setD] = useState<Draft>(initial); const [sample, setSample] = useState(SAMPLE); const create = useCmd('createWorkflow', { invalidate: ['listWorkflows'] }); const [done, setDone] = useState<{ version: number } | null>(null);
  const parsed = useMemo(() => WorkflowBody.safeParse(toBody(d)), [d]);
  let sampleCtx: { ok: true; payload: Record<string, unknown> } | { ok: false } = { ok: true, payload: {} };
  try { const p = JSON.parse(sample || '{}'); sampleCtx = p && typeof p === 'object' && !Array.isArray(p) ? { ok: true, payload: p } : { ok: false }; } catch { sampleCtx = { ok: false }; }
  const preview = parsed.success && sampleCtx.ok ? previewWorkflow(parsed.data.definition, { topic: d.triggerTopic, aggregateType: 'job', aggregateId: '00000000-0000-0000-0000-000000000000', payload: sampleCtx.payload }) : null;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const move = (i: number, by: -1 | 1) => { const a = [...d.actions]; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ actions: a }); };
  const patchAction = (i: number, p: Record<string, unknown>) => set({ actions: d.actions.map((a, k) => (k === i ? ({ ...a, ...p } as any) : a)) });
  const patchCond = (i: number, p: Partial<WorkflowConditionT>) => set({ conditions: d.conditions.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || 'definition'}: ${i.message}`);

  if (done) return (<div className="grid gap-4 p-1"><p className="text-sm">Saved <b className="font-mono">{d.key}</b> as <b>version {done.version}</b> (draft). Nothing runs until you activate it from the list.</p><div><Button onClick={onClose}>Done</Button></div></div>);
  return (<form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (parsed.success) create.mutate({ body: parsed.data as any }, { onSuccess: (r: any) => setDone({ version: r.version }) } as any); }}>
    <FormGrid><TextField label="Workflow key" placeholder="late-pod-chase" disabled={locked} value={d.key} onChange={(e) => set({ key: e.target.value })} /><SelectField label="Starts when this event happens" value={d.triggerTopic} onChange={(e) => set({ triggerTopic: e.target.value })}>{EVENT_TOPICS.map((t) => <option key={t}>{t}</option>)}</SelectField></FormGrid>
    <TextField label="Description" value={d.description} onChange={(e) => set({ description: e.target.value })} />

    <fieldset className="grid gap-2"><legend className="mb-1 font-display text-sm font-semibold">Only if… <span className="font-normal text-steel">(all must hold · optional)</span></legend>
      {d.conditions.map((c, i) => <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_130px_1fr_auto]">
        <Field label={i === 0 ? 'Field' : ' '}><input list="wf-fields" aria-label={`Condition ${i + 1} field`} className={inputCls + ' font-mono'} value={c.field} onChange={(e) => patchCond(i, { field: e.target.value })} /></Field>
        <SelectField label={i === 0 ? 'Is' : ' '} aria-label={`Condition ${i + 1} operator`} value={c.op} onChange={(e) => patchCond(i, { op: e.target.value as any })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        <TextField label={i === 0 ? 'Value' : ' '} aria-label={`Condition ${i + 1} value`} disabled={c.op === 'exists'} value={String(c.value ?? '')} onChange={(e) => patchCond(i, { value: e.target.value })} />
        <Button type="button" size="sm" variant="ghost" onClick={() => set({ conditions: d.conditions.filter((_, k) => k !== i) })}>Remove</Button></div>)}
      <datalist id="wf-fields">{FIELD_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
      {d.conditions.length < WORKFLOW_LIMITS.maxConditions && <div><Button type="button" size="sm" variant="ghost" onClick={() => set({ conditions: [...d.conditions, { field: 'payload.', op: 'eq', value: '' }] })}>+ Add condition</Button></div>}</fieldset>

    <fieldset className="grid gap-2"><legend className="mb-1 font-display text-sm font-semibold">Then, in order…</legend>
      {d.actions.map((a, i) => <div key={i} className="grid gap-2 rounded-sm border border-line bg-paper p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-800 font-mono text-xs text-white">{i + 1}</span>
          <select aria-label={`Step ${i + 1} type`} className={inputCls + ' !w-auto'} value={a.type} onChange={(e) => set({ actions: d.actions.map((x, k) => k === i ? (e.target.value === 'create_task' ? { type: 'create_task', title: '' } : e.target.value === 'notify' ? { type: 'notify', channel: 'internal', template: '' } : { type: 'wait', seconds: 1, _unit: 'hours' }) as any : x) })}><option value="create_task">Create a task</option><option value="notify">Send a notification</option><option value="wait">Wait</option></select>
          <span className="flex-1" /><Button type="button" size="sm" variant="ghost" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button><Button type="button" size="sm" variant="ghost" aria-label={`Move step ${i + 1} down`} disabled={i === d.actions.length - 1} onClick={() => move(i, 1)}>↓</Button><Button type="button" size="sm" variant="ghost" disabled={d.actions.length === 1} onClick={() => set({ actions: d.actions.filter((_, k) => k !== i) })}>Remove</Button></div>
        {a.type === 'create_task' && <FormGrid><TextField label="Task title (use {{payload.jobId}})" aria-label={`Step ${i + 1} title`} value={a.title} onChange={(e) => patchAction(i, { title: e.target.value })} /><TextField label="Due in (hours, optional)" inputMode="numeric" value={a.dueInHours ?? ''} onChange={(e) => patchAction(i, { dueInHours: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormGrid>}
        {a.type === 'notify' && <FormGrid><SelectField label="Channel" value={a.channel} onChange={(e) => patchAction(i, { channel: e.target.value })}><option value="internal">internal</option><option value="email">email</option><option value="whatsapp">whatsapp</option></SelectField><TextField label="Template name" aria-label={`Step ${i + 1} template`} value={a.template} onChange={(e) => patchAction(i, { template: e.target.value })} /></FormGrid>}
        {a.type === 'wait' && <FormGrid><TextField label="Wait for" inputMode="decimal" aria-label={`Step ${i + 1} amount`} value={a.seconds} onChange={(e) => patchAction(i, { seconds: e.target.value === '' ? '' : Number(e.target.value) })} /><SelectField label="Unit" aria-label={`Step ${i + 1} unit`} value={a._unit ?? 'seconds'} onChange={(e) => patchAction(i, { _unit: e.target.value })}>{Object.keys(UNIT).map((u) => <option key={u}>{u}</option>)}</SelectField></FormGrid>}</div>)}
      {d.actions.length < WORKFLOW_LIMITS.maxActions && <div><Button type="button" size="sm" variant="ghost" onClick={() => set({ actions: [...d.actions, { type: 'create_task', title: '' }] })}>+ Add step</Button></div>}</fieldset>

    <section aria-label="Preview" className="grid gap-2 rounded-sm border border-line p-3"><h4 className="font-display text-sm font-semibold">Dry run <span className="font-normal text-steel">— nothing is executed</span></h4>
      <label className="grid gap-1.5 text-sm"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">Sample event payload (JSON)</span><textarea aria-label="Sample payload" rows={4} className="rounded-sm border border-line-strong p-2 font-mono text-xs" value={sample} onChange={(e) => setSample(e.target.value)} /></label>
      {!sampleCtx.ok ? <p role="alert" className="text-sm text-[#A80000]">The sample must be a JSON object.</p> : !preview ? <p className="text-sm text-steel">Fix the issues below to see what would happen.</p>
        : !preview.matches ? <p className="text-sm"><Chip tone="hold">skipped</Chip> The conditions are not met for this sample, so no steps would run.</p>
        : <ol className="grid gap-1 text-sm">{preview.steps.map((s) => <li key={s.index} data-testid="preview-step" className="flex gap-2"><span className="font-mono text-steel">{s.index + 1}.</span>{s.summary}</li>)}</ol>}</section>

    {issues.length > 0 && <ul role="alert" aria-label="Validation issues" className="grid gap-1 rounded-sm bg-status-hold-100 p-3 text-sm">{issues.map((m) => <li key={m}>{m}</li>)}</ul>}
    <ErrorNote e={create.error} />
    <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={!parsed.success || create.isPending}>{create.isPending ? 'Saving…' : 'Save as draft version'}</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><span className="text-xs text-steel">Published versions never change; to edit, save a new version.</span></div>
  </form>);
}
export { Modal } from '@dbl/ui';
