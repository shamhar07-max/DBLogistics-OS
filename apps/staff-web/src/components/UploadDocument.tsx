'use client';
import { useState } from 'react';
import { Button } from '@dbl/ui';
import { useCmd } from '@/lib/hooks';
import { ErrorNote, Field, inputCls } from '@/components/bits';

const sha256 = async (f: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
/** upload intent → direct PUT to private storage → register immutable version (scan runs in the worker) */
export function UploadDocument({ relatedType, relatedId }: { relatedType: string; relatedId: string }) {
  const intent = useCmd('createUploadIntent'); const register = useCmd('registerDocument'); const [file, setFile] = useState<File | null>(null); const [docType, setDocType] = useState('BL'); const [issuer, setIssuer] = useState<'carrier' | 'authority' | 'customer' | 'supplier' | 'internal'>('carrier'); const [msg, setMsg] = useState(''); const [err, setErr] = useState<unknown>();
  const go = async () => { if (!file) return; setErr(undefined); try {
    const i = await intent.mutateAsync({ body: { contentType: file.type || 'application/octet-stream', sizeBytes: file.size } });
    const put = await fetch(i.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); if (!put.ok) throw new Error('Upload to storage failed');
    const d = await register.mutateAsync({ body: { intentId: i.intentId, docType, issuerKind: issuer, relatedType, relatedId, sha256: await sha256(file) } }); setMsg(`Registered ${d.id} · scan ${d.scanStatus}`); } catch (e) { setErr(e); } };
  return <div className="grid max-w-md gap-3"><input aria-label="File" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    <Field label="Document type"><input className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)} /></Field>
    <Field label="Issuer"><select className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value as any)}>{['carrier', 'authority', 'customer', 'supplier', 'internal'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Button disabled={!file} onClick={go}>Upload</Button>{msg && <p className="text-sm text-status-ok">{msg}</p>}<ErrorNote e={err} /></div>;
}
