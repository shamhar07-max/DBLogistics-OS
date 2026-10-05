import * as React from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'motion/react';
import { MOTION } from '@dbl/design-tokens';

/** True when the user (or OS) asked for less motion — mirrors the global "Pause motion" switch used on digitalburj.com. */
export function useCalm() { const reduce = useReducedMotion(); const [paused, setPaused] = React.useState(false);
  React.useEffect(() => { const el = document.documentElement; const sync = () => setPaused(el.dataset.motion === 'paused'); sync(); const o = new MutationObserver(sync); o.observe(el, { attributes: true, attributeFilter: ['data-motion'] }); return () => o.disconnect(); }, []);
  return !!reduce || paused; }

const chamfer = { clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' } as const;
export function Button({ variant = 'primary', size = 'md', className, style, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'signal' | 'ghost'; size?: 'sm' | 'md' }) {
  return <button {...p} style={{ ...chamfer, ...style }} className={clsx('inline-flex items-center gap-2 font-display font-semibold transition duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]',
    size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm', variant === 'primary' && 'bg-brand-800 text-white hover:bg-brand-700', variant === 'signal' && 'bg-signal-action text-white hover:bg-signal-deep', variant === 'ghost' && 'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-brand-50', className)} />;
}
const tones = { ok: 'bg-status-ok-100 text-[#0C6B3F]', hold: 'bg-status-hold-100 text-[#8A5F00]', stop: 'bg-status-stop-100 text-[#A80000]', info: 'bg-status-info-100 text-status-info', idle: 'bg-paper-2 text-steel' } as const;
export type Tone = keyof typeof tones;
export function Chip({ tone = 'idle', live, children }: { tone?: Tone; live?: boolean; children: React.ReactNode }) {
  return <span className={clsx('inline-flex h-[22px] items-center gap-1.5 rounded-xs px-2 font-label text-[11px] font-semibold uppercase tracking-[.07em] whitespace-nowrap', tones[tone])}><i className={clsx('h-1.5 w-1.5 rounded-full bg-current', live && 'animate-pulse')} />{children}</span>;
}
/** Tracking events always show their SOURCE; inferred values are hatched so estimates never pass as actuals. */
export function SourceBadge({ source, actual }: { source: string; actual: boolean }) {
  return <span data-testid="source-badge" className={clsx('inline-flex items-center rounded-[3px] px-1.5 py-[3px] font-mono text-[10.5px]', actual && source === 'carrier' ? 'bg-status-ok-100 text-[#0C6B3F]' : actual ? 'bg-paper text-steel' : 'bg-[repeating-linear-gradient(-45deg,var(--paper)_0_4px,var(--paper-2)_4px_8px)] text-steel')}>{actual ? source : `estimated · ${source}`}</span>;
}
export function Card({ title, actions, children, className, cast }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; cast?: boolean }) {
  const calm = useCalm();
  return <motion.section initial={calm ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: MOTION.slow / 1000, ease: MOTION.ease }}
    className={clsx('rounded-md border border-line bg-surface shadow-card', cast && 'rounded-tr-none', className)} style={cast ? chamfer : undefined}>
    {title && <header className="flex items-center gap-2 border-b border-line px-4 py-3"><h3 className="font-display text-sm font-semibold">{title}</h3><span className="flex-1" />{actions}</header>}
    <div className="p-4">{children}</div></motion.section>;
}
export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'risk' }) {
  return <div className={clsx('rounded-md border border-line bg-surface p-4 shadow-card', tone === 'risk' && 'shadow-[inset_0_3px_0_var(--dbl-signal)]')}><div className="font-label text-xs font-semibold uppercase tracking-[.09em] text-steel">{label}</div><div className="mt-2 font-label text-3xl font-bold tabular-nums">{value}</div>{hint && <div className="mt-1 text-xs text-steel">{hint}</div>}</div>;
}
export type Stop = { label: string; sub?: string; state: 'done' | 'now' | 'hold' | 'todo'; source?: React.ReactNode };
export function RouteLane({ stops }: { stops: Stop[] }) {
  return <ol className="grid auto-cols-fr grid-flow-col" aria-label="Route">{stops.map((s, i) => <li key={i} className="relative pt-9 text-center text-xs">
    <i className={clsx('absolute left-1/2 top-2.5 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-[3px] bg-surface', s.state === 'done' && 'border-status-ok bg-status-ok', s.state === 'now' && 'border-signal-100 bg-signal animate-pulse', s.state === 'hold' && 'border-[var(--mode-road)] bg-mode-road', s.state === 'todo' && 'border-line-strong')} />
    {i > 0 && <i className={clsx('absolute left-[-50%] top-4 h-0.5 w-full', s.state === 'todo' ? 'bg-[repeating-linear-gradient(90deg,var(--concrete)_0_6px,transparent_6px_11px)]' : 'bg-status-ok')} />}
    <b className="block font-display text-[12.5px]">{s.label}</b>{s.sub && <span className="block text-steel">{s.sub}</span>}{s.source}</li>)}</ol>;
}
/** Every page surface needs these five states. */
export function QueryBoundary({ status, error, isEmpty, empty, children, stale }: { status: 'pending' | 'error' | 'success'; error?: { status?: number; code?: string; message?: string } | null; isEmpty?: boolean; empty?: React.ReactNode; stale?: boolean; children: React.ReactNode }) {
  if (status === 'pending') return <div role="status" aria-busy="true" className="space-y-2" data-testid="loading">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-sm bg-paper-2" />)}</div>;
  if (status === 'error') { const forbidden = error?.status === 403 || error?.code === 'FORBIDDEN';
    return <div role="alert" data-testid={forbidden ? 'forbidden' : 'error'} className="rounded-md border border-status-stop bg-status-stop-100 p-4 text-sm text-[#A80000]"><b>{forbidden ? 'You don’t have access to this.' : 'Something went wrong.'}</b><div className="mt-1">{error?.message}</div></div>; }
  if (isEmpty) return <div data-testid="empty" className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-steel">{empty ?? 'Nothing here yet.'}</div>;
  return <>{stale && <div data-testid="stale" className="mb-2 text-xs text-steel">Showing last known data — refreshing…</div>}{children}</>;
}
