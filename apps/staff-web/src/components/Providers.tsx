'use client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { queryClient, setCsrf } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(queryClient);
  return <QueryClientProvider client={qc}><Csrf />{children}</QueryClientProvider>;
}
function Csrf() { useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((m) => m && setCsrf(m.csrf)); }, []); return null; }
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: async () => { const r = await fetch('/api/auth/me'); if (!r.ok) throw new Error('not signed in'); return r.json() as Promise<{ user: { sub: string; email?: string }; tenantId: string; workspace?: string; csrf: string }>; } });
