/** Tenant lifecycle use cases (platform-admin). Runs as the normal runtime role under RLS: tenant creation needs the explicit
 *  `app.provisioning` flag, then everything else is written inside the NEW tenant's context. */
import pg from 'pg';
import { PERMISSIONS, ROLE_TEMPLATES } from '@dbl/contracts';
import { seedLedger } from './finance';

const wrap = (c: pg.PoolClient) => ({
  q: async (s: string, p?: unknown[]) => (await c.query(s, p as any[])).rows,
  one: async (s: string, p?: unknown[]) => (await c.query(s, p as any[])).rows[0],
  maybe: async (s: string, p?: unknown[]) => (await c.query(s, p as any[])).rows[0],
});
export interface ProvisionInput { slug: string; name: string; currency?: string; ownerSubject: string; ownerEmail?: string; entityName?: string }
export interface Provisioned { tenantId: string; legalEntityId: string; facilityId: string; ownerUserId: string; ownerMembershipId: string; roleIds: Record<string, string> }

export async function provisionTenant(pool: pg.Pool, i: ProvisionInput): Promise<Provisioned> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.provisioning','on',true)`);
    const t = (await c.query(`INSERT INTO platform.tenants(slug, name, default_currency) VALUES ($1,$2,$3) RETURNING id`, [i.slug, i.name, i.currency ?? 'AED'])).rows[0];
    await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.id]);
    const roleIds: Record<string, string> = {};
    for (const [key, r] of Object.entries(ROLE_TEMPLATES)) {
      const row = (await c.query(`INSERT INTO platform.roles(tenant_id, key, name) VALUES ($1,$2,$3) RETURNING id`, [t.id, key, r.name])).rows[0]; roleIds[key] = row.id;
      for (const p of r.permissions) await c.query(`INSERT INTO platform.role_permissions(tenant_id, role_id, permission) VALUES ($1,$2,$3)`, [t.id, row.id, p]);
    }
    const le = (await c.query(`INSERT INTO org.legal_entities(tenant_id, name, base_currency) VALUES ($1,$2,$3) RETURNING id`, [t.id, i.entityName ?? i.name, i.currency ?? 'AED'])).rows[0];
    const fac = (await c.query(`INSERT INTO org.facilities(tenant_id, legal_entity_id, name, kind) VALUES ($1,$2,'Main warehouse','warehouse') RETURNING id`, [t.id, le.id])).rows[0];
    await seedLedger(wrap(c) as any, t.id, le.id);
    const u = await addMember(c, t.id, { subject: i.ownerSubject, email: i.ownerEmail, roles: ['owner'], workspace: 'staff' }, roleIds);
    await c.query(`INSERT INTO platform.audit_events(tenant_id, actor_user_id, actor_kind, action, entity_type, entity_id) VALUES ($1,$2,'system','tenant.provisioned','tenant',$1)`, [t.id, u.userId]);
    await c.query('COMMIT');
    return { tenantId: t.id, legalEntityId: le.id, facilityId: fac.id, ownerUserId: u.userId, ownerMembershipId: u.membershipId, roleIds };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function addMember(c: pg.PoolClient, tenantId: string, m: { subject: string; email?: string; roles: string[]; workspace?: string; partyId?: string; legalEntityId?: string }, roleIds: Record<string, string>) {
  const u = (await c.query(`INSERT INTO platform.users(subject, email) VALUES ($1,$2) ON CONFLICT (subject) DO UPDATE SET email = COALESCE(EXCLUDED.email, platform.users.email) RETURNING id`, [m.subject, m.email ?? null])).rows[0];
  const mem = (await c.query(`INSERT INTO platform.memberships(tenant_id, user_id, workspace, party_id) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, u.id, m.workspace ?? 'staff', m.partyId ?? null])).rows[0];
  for (const r of m.roles) await c.query(`INSERT INTO platform.membership_roles(tenant_id, membership_id, role_id, legal_entity_id) VALUES ($1,$2,$3,$4)`, [tenantId, mem.id, roleIds[r], m.legalEntityId ?? null]);
  return { userId: u.id, membershipId: mem.id };
}
/** Adds a member to an existing tenant (tenant context set by caller session). */
export async function addMemberToTenant(pool: pg.Pool, tenantId: string, m: Parameters<typeof addMember>[2]) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
    const roles = (await c.query(`SELECT key, id FROM platform.roles WHERE tenant_id=$1`, [tenantId])).rows; const roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id]));
    const out = await addMember(c, tenantId, m, roleIds); await c.query('COMMIT'); return out;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export const _PERMISSIONS = PERMISSIONS;
