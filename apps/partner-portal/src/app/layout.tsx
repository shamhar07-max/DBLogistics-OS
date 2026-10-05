import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
export const metadata: Metadata = { title: 'DigitalBurj Logistics — Partner portal', icons: { icon: '/favicon.ico' } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" data-motion="running"><body><Providers>{children}</Providers></body></html>; }
