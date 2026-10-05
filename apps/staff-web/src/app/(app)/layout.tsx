import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, unseal } from '@dbl/gateway';
import { loadGatewayEnv } from '@dbl/configuration';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await unseal((await cookies()).get(COOKIE)?.value, loadGatewayEnv().SESSION_SECRET);
  if (!s) redirect('/login');
  return <Shell>{children}</Shell>;
}
