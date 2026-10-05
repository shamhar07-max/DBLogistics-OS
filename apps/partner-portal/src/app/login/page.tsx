'use client';
import { useState } from 'react';
import { Button } from '@dbl/ui';

export default function Login() {
  const [subject, setSubject] = useState(''); const [tenantId, setTenantId] = useState(''); const [err, setErr] = useState('');
  const dev = process.env.NODE_ENV !== 'production';
  return (
    <main className="grid min-h-screen place-items-center bg-paper p-6">
      <div className="w-full max-w-md rounded-md border border-line bg-white p-8 shadow-float">
        <div className="relative mx-auto mb-6 w-full overflow-hidden" style={{ aspectRatio: '1760/480' }}><img src="/logo.png" alt="DigitalBurj Logistics OS" className="absolute max-w-none" style={{ width: '112.67%', left: '-7.67%', top: '-29.17%' }} /></div>
        <h1 className="font-display text-2xl font-bold">Sign in</h1>
        <a href="/api/auth/login" className="mt-4 block"><Button className="w-full justify-center">Continue with single sign-on</Button></a>
        {dev && <form className="mt-6 space-y-3 border-t border-line pt-5" onSubmit={async (e) => { e.preventDefault(); const r = await fetch('/api/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, tenantId }) }); if (r.ok) location.href = '/'; else setErr((await r.json()).message ?? 'Failed'); }}>
          <div className="font-label text-xs font-semibold uppercase tracking-wider text-steel">Local development login</div>
          <input className="h-10 w-full rounded-sm border border-line-strong px-3 text-sm" placeholder="OIDC subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <input className="h-10 w-full rounded-sm border border-line-strong px-3 font-mono text-sm" placeholder="Tenant id (uuid)" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          <Button variant="ghost" type="submit">Dev sign in</Button>{err && <p role="alert" className="text-sm text-status-stop">{err}</p>}</form>}
      </div>
    </main>
  );
}
