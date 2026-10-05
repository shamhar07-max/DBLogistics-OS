import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, unseal } from '@dbl/gateway';
import { loadGatewayEnv } from '@dbl/configuration';
import { PortalShell } from '@/components/PortalShell';

export const dynamic = 'force-dynamic';
/** External portal shell: no internal navigation, no margins — only what the party's own grants allow. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await unseal((await cookies()).get(COOKIE)?.value, loadGatewayEnv().SESSION_SECRET); if (!s) redirect('/login');
  return <PortalShell>{children}</PortalShell>;
}
