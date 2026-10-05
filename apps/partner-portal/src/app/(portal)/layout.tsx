import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, unseal } from '@dbl/gateway';
import { loadGatewayEnv } from '@dbl/configuration';

export const dynamic = 'force-dynamic';
/** External portal shell: no internal navigation, no margins — only what the party's own grants allow. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await unseal((await cookies()).get(COOKIE)?.value, loadGatewayEnv().SESSION_SECRET); if (!s) redirect('/login');
  return <div className="min-h-screen bg-paper"><header className="flex items-center gap-4 border-b border-line bg-white px-8 py-3"><div className="relative w-48 overflow-hidden" style={{ aspectRatio: '1760/480' }}><img src="/logo.png" alt="DigitalBurj Logistics OS" className="absolute max-w-none" style={{ width: '112.67%', left: '-7.67%', top: '-29.17%' }} /></div><span className="flex-1" /><Link href="/" className="text-sm font-semibold">My shipments</Link><Link href="/api/auth/logout" prefetch={false} className="text-sm text-steel underline">Sign out</Link></header><main className="mx-auto grid max-w-5xl gap-5 p-8">{children}</main></div>;
}
