'use client';
import clsx from 'clsx';
import { Chip, type Tone } from '@dbl/ui';
import { ApiError } from '@/lib/api';

export const statusTone = (s: string): Tone => (['delivered', 'closed', 'posted', 'approved', 'accepted', 'released', 'settled', 'clean', 'confirmed'].includes(s) ? 'ok' : ['executing', 'in_transit', 'billed', 'sent', 'open', 'requested', 'qualified'].includes(s) ? 'info' : ['draft', 'new', 'planned', 'pending', 'partially_billed'].includes(s) ? 'hold' : ['cancelled', 'rejected', 'expired', 'quarantined'].includes(s) ? 'stop' : 'idle');
export const StatusChip = ({ s }: { s: string }) => <Chip tone={statusTone(s)}>{s.replace(/_/g, ' ')}</Chip>;
export const Field = ({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) => <label className="grid gap-1.5"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">{label}</span>{children}{error && <span role="alert" className="text-xs text-status-stop">{error}</span>}</label>;
export const inputCls = 'h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';
export const ErrorNote = ({ e }: { e: unknown }) => (e ? <p role="alert" className={clsx('rounded-sm px-3 py-2 text-sm', 'bg-status-stop-100 text-[#A80000]')}>{e instanceof ApiError ? <><b>{e.code}</b> — {e.message}</> : String(e)}</p> : null);
export const PageTitle = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => <div className="flex items-end gap-4"><div><div className="font-label text-xs font-semibold uppercase tracking-[.1em] text-steel">{sub}</div><h1 className="text-3xl font-bold tracking-tight">{title}</h1></div><span className="flex-1" />{children}</div>;
