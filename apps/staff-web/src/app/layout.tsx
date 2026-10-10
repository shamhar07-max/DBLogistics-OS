import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'DigitalBurj Logistics OS', icons: { icon: '/favicon.ico' } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-motion="running"><body>{process.env.RAILWAY_FREE_PILOT === 'true' && <aside role="status" style={{padding: 12, background: '#fff3cd', color: '#332701'}}>Free pilot: background automation and document uploads are unavailable.</aside>}<Providers>{children}</Providers></body></html>;
}
