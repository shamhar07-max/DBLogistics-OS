'use client';
import { useState } from 'react';
import { Button } from '@dbl/ui';
import { useCmd } from '@/lib/hooks';
import { ErrorNote, Field, inputCls } from '@/components/bits';

const sha256 = async (f: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
export const DOC_TYPES = ['Commercial invoice', 'Packing list', 'Bill of lading / AWB', 'Proof of delivery', 'Certificate of origin', 'Delivery order', 'Other'];
/** upload intent → direct PUT to private storage → register an immutable version (malware scan runs before anyone can open it). The issuer is set by the server from who you are. */
export function UploadDocument({ relatedType, relatedId, onDone, defaultType = DOC_TYPES[0] }: { relatedType: 'shipment' | 'job' | 'trip'; relatedId: string; onDone?: () => void; defaultType?: string }) {
  const intent = useCmd('createUploadIntent'); const register = useCmd('registerDocument', { invalidate: ['listDocuments'] }); const [file, setFile] = useState<File | null>(null); const [docType, setDocType] = useState(defaultType); const [ref, setRef] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState<unknown>(); const [busy, setBusy] = useState(false);
  const go = async () => { if (!file) return; setErr(undefined); setMsg(''); setBusy(true); try {
    const i = await intent.mutateAsync({ body: { contentType: file.type || 'application/octet-stream', sizeBytes: file.size } });
    const put = await fetch(i.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); if (!put.ok) throw new Error('Upload to storage failed');
    await register.mutateAsync({ body: { intentId: i.intentId, docType, issuerKind: 'customer', ...(ref ? { externalReference: ref } : {}), relatedType, relatedId, sha256: await sha256(file) } });
    setMsg('Uploaded — it will be available after the security scan and review.'); setFile(null); onDone?.(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (<div className="grid max-w-md gap-3"><label className="grid gap-1.5"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">File (max 50 MB)</span><input aria-label="File" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
    <Field label="Document type"><select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Reference (optional)"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
    <Button disabled={!file || busy} onClick={go}>{busy ? 'Uploading…' : 'Upload'}</Button>{msg && <p role="status" className="text-sm text-status-ok">{msg}</p>}<ErrorNote e={err} /></div>);
}
