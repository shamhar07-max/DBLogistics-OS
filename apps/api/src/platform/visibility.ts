import type { RequestContext } from './context';
import { isExternal } from './context';

/**
 * Party-level visibility for EXTERNAL workspaces. Permissions say what a user may do; these predicates say which
 * records they may do it to. Staff see everything their permissions/entity grants allow (predicate is `true`).
 *   customer     → shipments of their own jobs
 *   agent        → shipments where they operate a leg
 *   transporter  → shipments on dispatched trips of their company
 * Anything else external sees nothing.
 */
export function shipmentVisibility(ctx: RequestContext, s: string, j: string, p: number): string {
  if (!isExternal(ctx)) return 'true';
  switch (ctx.workspace) {
    case 'customer': return `${j}.customer_party_id = $${p}`;
    case 'agent': return `EXISTS (SELECT 1 FROM logistics.legs vl WHERE vl.shipment_id = ${s}.id AND vl.operator_party_id = $${p})`;
    case 'transporter': case 'driver':
      return `EXISTS (SELECT 1 FROM transport.trip_stops vts JOIN transport.trips vt ON vt.id = vts.trip_id WHERE vts.shipment_id = ${s}.id AND vt.transporter_party_id = $${p} AND vt.status IN ('dispatched','in_progress','completed'))`;
    default: return 'false';
  }
}
/** Documents: an external user sees what they uploaded, plus APPROVED, non-internal documents attached to records they can see. */
export function documentVisibility(ctx: RequestContext, d: string, uid: number, p: number): string {
  if (!isExternal(ctx)) return 'true';
  const sh = `EXISTS (SELECT 1 FROM logistics.shipments vs JOIN logistics.jobs vj ON vj.id = vs.job_id WHERE vs.id = ${d}.related_id AND ${shipmentVisibility(ctx, 'vs', 'vj', p)})`;
  const job = ctx.workspace === 'customer' ? `EXISTS (SELECT 1 FROM logistics.jobs vj2 WHERE vj2.id = ${d}.related_id AND vj2.customer_party_id = $${p})` : 'false';
  const trip = ['transporter', 'driver'].includes(ctx.workspace) ? `EXISTS (SELECT 1 FROM transport.trips vt2 WHERE vt2.id = ${d}.related_id AND vt2.transporter_party_id = $${p})` : 'false';
  return `(${d}.created_by = $${uid} OR (${d}.status = 'approved' AND ${d}.issuer_kind <> 'internal' AND ((${d}.related_type = 'shipment' AND ${sh}) OR (${d}.related_type = 'job' AND ${job}) OR (${d}.related_type = 'trip' AND ${trip}))))`;
}
/** May this external user attach a document to / act on this record? Staff: always (their permissions decide). */
export async function canTouch(tx: { maybe: (sql: string, a?: unknown[]) => Promise<unknown> }, ctx: RequestContext, type: string, id: string): Promise<boolean> {
  if (!isExternal(ctx)) return true;
  if (type === 'shipment') return !!(await tx.maybe(`SELECT 1 FROM logistics.shipments s JOIN logistics.jobs j ON j.id = s.job_id WHERE s.id = $1 AND ${shipmentVisibility(ctx, 's', 'j', 2)}`, [id, ctx.partyId]));
  if (type === 'job') return ctx.workspace === 'customer' && !!(await tx.maybe(`SELECT 1 FROM logistics.jobs WHERE id = $1 AND customer_party_id = $2`, [id, ctx.partyId]));
  if (type === 'trip') return ['transporter', 'driver'].includes(ctx.workspace) && !!(await tx.maybe(`SELECT 1 FROM transport.trips WHERE id = $1 AND transporter_party_id = $2 AND status <> 'cancelled'`, [id, ctx.partyId]));
  if (type === 'quote') return ctx.workspace === 'customer' && !!(await tx.maybe(`SELECT 1 FROM commercial.quotes WHERE id = $1 AND customer_party_id = $2 AND status IN ('approved','sent','accepted','expired')`, [id, ctx.partyId]));
  return false;
}
/** The issuer an external upload may claim is fixed by who they are — a portal user can never mint "authority" evidence. */
export const externalIssuerKind = (ctx: RequestContext): 'customer' | 'supplier' | 'carrier' | null =>
  ctx.workspace === 'customer' ? 'customer' : ctx.workspace === 'agent' ? 'supplier' : ['transporter', 'driver'].includes(ctx.workspace) ? 'carrier' : null;
