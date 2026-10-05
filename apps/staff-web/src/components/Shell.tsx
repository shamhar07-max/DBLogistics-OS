'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Anchor, BarChart3, Bell, Boxes, Briefcase, CheckCircle2, FileText, Gauge, LayoutGrid, Pause, Play, Receipt, Settings2, ShieldCheck, Sparkles, Stamp, Truck, Users, Warehouse, Zap, Wallet, Contact } from 'lucide-react';
import { ENVIRONMENTS, envAttr, type Environment } from '@dbl/design-tokens';
import clsx from 'clsx';

const NAV = [
  ['Today', '/', LayoutGrid], ['Customers', '/customers', Users], ['Enquiries & Quotes', '/enquiries', FileText], ['Shipments', '/jobs', Boxes], ['Transport', '/transport', Truck],
  ['Warehouses', '/warehouse', Warehouse], ['Customs & Trade', '/customs', Stamp], ['Documents', '/documents', Briefcase], ['Money', '/finance', Wallet], ['People & Assets', '/people', Contact],
  ['Service & Quality', '/quality', ShieldCheck], ['Intelligence', '/intelligence', Sparkles], ['Automation', '/automation', Zap], ['Administration', '/admin', Settings2],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const [paused, setPaused] = useState(false); const [env, setEnv] = useState<Environment>('owner');
  const toggle = () => { const n = !paused; setPaused(n); document.documentElement.dataset.motion = n ? 'paused' : 'running'; };
  return (
    <div className="grid min-h-screen grid-cols-[264px_1fr]" data-env={envAttr(env)}>
      <aside className="sticky top-0 flex h-screen flex-col bg-brand-900 text-[#C7DAD4]">
        <div className="m-3.5 rounded-[10px] bg-white p-3.5">
          {/* master logo, unmodified — only its empty margin is trimmed by the crop box */}
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1760/480' }}><img src="/logo.png" alt="DigitalBurj Logistics OS — One system. Every operation." className="absolute max-w-none" style={{ width: '112.67%', left: '-7.67%', top: '-29.17%' }} /></div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-auto px-2.5" aria-label="Primary">
          {NAV.map(([label, href, Icon]) => { const active = href === '/' ? path === '/' : href === '/enquiries' ? ['/enquiries', '/quotes'].some((x) => path.startsWith(x)) : path.startsWith(href); return <Link key={href} href={href} aria-current={active ? 'page' : undefined}
              className={clsx('relative flex items-center gap-3 rounded-sm px-2.5 py-2 text-[13.5px] transition hover:translate-x-0.5 hover:bg-white/5', active && 'bg-gradient-to-r from-signal/25 to-transparent text-white')}>
              {active && <i className="absolute -left-2.5 top-1.5 bottom-1.5 w-1 rounded-r bg-signal" />}<Icon size={17} className={active ? 'text-white' : 'text-[#7FA79C]'} />{label}</Link>; })}
        </nav>
        <div className="border-t border-white/10 p-3.5 text-xs text-[#8FB0A7]"><Link href="/api/auth/logout" prefetch={false} className="underline">Sign out</Link></div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3.5 border-b border-line bg-paper/90 px-7 py-3 backdrop-blur">
          <div className="flex rounded-md bg-paper-2 p-[3px]" role="tablist" aria-label="Working environment">{ENVIRONMENTS.slice(0, 6).map((e) => <button key={e} role="tab" aria-selected={env === e} onClick={() => setEnv(e)} className={clsx('rounded-[8px] px-3 py-1.5 font-display text-[12.5px] font-semibold capitalize transition', env === e ? 'bg-brand-800 text-white shadow-raised' : 'text-steel')}>{e}</button>)}</div>
          <span className="flex-1" />
          <button onClick={toggle} aria-pressed={paused} className="flex h-9 items-center gap-2 rounded-sm border border-line-strong bg-white px-3 text-xs font-semibold text-steel">{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume motion' : 'Pause motion'}</button>
          <Link href="/approvals" className="relative grid h-9 w-9 place-items-center rounded-sm border border-line-strong bg-white" aria-label="Approvals inbox"><Bell size={17} /></Link>
        </header>
        <main className="grid gap-5 px-7 pb-10 pt-6">{children}</main>
      </div>
    </div>
  );
}
void Anchor; void BarChart3; void CheckCircle2; void Gauge; void Receipt; void ShieldCheck; void Truck;
