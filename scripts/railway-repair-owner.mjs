import pg from 'pg';

// One-shot repair: reconcile the imported OIDC owner with the existing tenant owner.
// Credentials belong only on the completed bootstrap service, never on the runtime.
const need = key => { const value = process.env[key]; if (!value) throw new Error(`${key} is required`); return value; };
async function json(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Identity request failed (${response.status})`);
  return response.json();
}
const base = need('REPAIR_IDENTITY_URL').replace(/\/$/, '');
const realm = process.env.REPAIR_REALM || 'dbl';
const username = process.env.REPAIR_OWNER_USERNAME || 'owner';
const token = await json(`${base}/realms/master/protocol/openid-connect/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: need('REPAIR_ADMIN_USERNAME'), password: need('REPAIR_ADMIN_PASSWORD') }),
});
const users = await json(`${base}/admin/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`, { headers: { Authorization: `Bearer ${token.access_token}` } });
if (users.length !== 1 || users[0].username !== username || !users[0].enabled) throw new Error('Expected exactly one enabled identity owner');
const identity = users[0];
const database = new URL(need('ADMIN_DATABASE_URL')); database.pathname = '/dbl';
const db = new pg.Client({ connectionString: database.toString() });
await db.connect();
try {
  await db.query('BEGIN');
  const owners = await db.query(`SELECT DISTINCT m.id, m.user_id, m.tenant_id FROM platform.memberships m
    JOIN platform.tenants t ON t.id=m.tenant_id JOIN platform.membership_roles mr ON mr.membership_id=m.id AND mr.tenant_id=m.tenant_id
    JOIN platform.roles r ON r.id=mr.role_id AND r.tenant_id=m.tenant_id
    WHERE t.slug=$1 AND r.key='owner' AND m.status='active' AND m.workspace='staff'`, [need('TENANT_SLUG')]);
  if (owners.rows.length !== 1) throw new Error('Expected exactly one existing staff owner membership; no changes made');
  const owner = owners.rows[0];
  const user = (await db.query(`INSERT INTO platform.users(subject,email) VALUES ($1,$2)
    ON CONFLICT(subject) DO UPDATE SET email=COALESCE(EXCLUDED.email,platform.users.email) RETURNING id`, [identity.id, identity.email || null])).rows[0];
  if (owner.user_id !== user.id) {
    await db.query('UPDATE platform.memberships SET user_id=$1 WHERE id=$2 AND tenant_id=$3', [user.id, owner.id, owner.tenant_id]);
    await db.query(`INSERT INTO platform.audit_events(tenant_id,actor_user_id,actor_kind,action,entity_type,entity_id,detail)
      VALUES ($1,$2,'system','identity.owner_relinked','membership',$3,$4::jsonb)`, [owner.tenant_id,user.id,owner.id,JSON.stringify({previousUserId:owner.user_id,subject:identity.id})]);
  }
  await db.query('COMMIT');
  console.log('Owner identity linked to existing tenant; existing roles preserved.');
  console.log('Tenant:', owner.tenant_id);
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { await db.end(); }
