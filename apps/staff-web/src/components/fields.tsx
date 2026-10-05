'use client';
import * as React from 'react';
import { FormGrid, SelectField } from '@dbl/ui';
import { useOp } from '@/lib/hooks';

type Base = { label: string; error?: string };
const opts = (rows: any[] | undefined, label: (r: any) => string) => (rows ?? []).map((r) => <option key={r.id} value={r.id}>{label(r)}</option>);
type SelProps = Base & React.SelectHTMLAttributes<HTMLSelectElement> & { role?: string };
/** Pickers load their options through the same typed API as every other screen. */
export function PartyPicker({ role, ...p }: SelProps & { role?: string }) { const q = useOp('listParties'); const rows = ((q.data as any[]) ?? []).filter((r) => !role || r.roles.includes(role)); return <SelectField {...p}><option value="">Select…</option>{opts(rows, (r) => r.legal_name)}</SelectField>; }
export function EntityPicker(p: SelProps) { const q = useOp('listLegalEntities'); return <SelectField {...p}><option value="">Select…</option>{opts(q.data as any[], (r) => r.name)}</SelectField>; }
export function EmployeePicker(p: SelProps) { const q = useOp('listEmployees'); return <SelectField {...p}><option value="">None</option>{opts(q.data as any[], (r) => r.full_name)}</SelectField>; }
export function JobPicker(p: SelProps) { const q = useOp('listJobs'); return <SelectField {...p}><option value="">Select…</option>{opts(q.data as any[], (r) => r.ref)}</SelectField>; }
export function ShipmentPicker({ jobId, ...p }: SelProps & { jobId?: string }) { const q = useOp('listShipments'); const rows = ((q.data as any[]) ?? []).filter((s) => !jobId || s.job_id === jobId); return <SelectField {...p}><option value="">Select…</option>{opts(rows, (r) => `${r.ref} · ${r.origin} → ${r.destination}`)}</SelectField>; }
export function LotPicker(p: SelProps) { const q = useOp('listLots'); return <SelectField {...p}><option value="">Select…</option>{opts(q.data as any[], (r) => `${r.description} (${Number(r.qty_available)} avail.)`)}</SelectField>; }
export function FacilityPicker(p: SelProps) { const q = useOp('listFacilities'); return <SelectField {...p}><option value="">Select…</option>{opts(q.data as any[], (r) => `${r.name} (${r.kind})`)}</SelectField>; }
export { AreaField, FormGrid, SelectField, TextField } from '@dbl/ui';
