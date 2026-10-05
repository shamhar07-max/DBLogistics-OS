'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { QueryBoundary } from '@dbl/ui';
import { errView } from '@/lib/hooks';
import { navFor, useWho } from '@/components/Me';

const WORKSPACE_LABEL: Record<string, string> = { customer: 'Customer portal', agent: 'Agent portal', transporter: 'Transporter portal', driver: 'Driver portal' };
export function PortalShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const { me, status, error } = useWho(); const nav = navFor(me?.workspace);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
          {/* master logo, unmodified — only its empty margin is trimmed by the crop box */}
          <div className="relative w-40 shrink-0 overflow-hidden sm:w-48" style={{ aspectRatio: '1760/480' }}><img src="/logo.png" alt="DigitalBurj Logistics OS" className="absolute max-w-none" style={{ width: '112.67%', left: '-7.67%', top: '-29.17%' }} /></div>
          <span className="flex-1" />
          <div className="text-right text-xs leading-tight"><div className="font-label font-semibold uppercase tracking-[.1em] text-steel">{WORKSPACE_LABEL[me?.workspace ?? ''] ?? 'Partner portal'}</div><div data-testid="who" className="font-display text-sm font-semibold">{me?.partyName ?? me?.email ?? ''}</div></div>
          <Link href="/api/auth/logout" prefetch={false} className="text-sm text-steel underline">Sign out</Link>
        </div>
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 sm:px-7">
          {nav.map((n) => <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={clsx('relative shrink-0 whitespace-nowrap px-3.5 py-2.5 font-display text-[13.5px] font-semibold transition', active(n.href) ? 'text-ink after:absolute after:inset-x-2.5 after:-bottom-px after:h-[3px] after:bg-signal' : 'text-steel hover:text-ink')}>{n.label}</Link>)}
        </nav>
      </header>
      <main className="mx-auto grid min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] gap-5 px-4 pb-12 pt-6 sm:px-8"><QueryBoundary status={status} error={errView(error)}>{children}</QueryBoundary></main>
    </div>
  );
}
