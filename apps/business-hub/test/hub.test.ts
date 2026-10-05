import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { memoryD1 } from './d1';
import { SECTORS } from '../src/ui';
import { modulesFor, MODULES, ROLE_KEYS, can } from '../src/roles';
import { hashPassword, passwordIssue, verifyPassword } from '../src/security';

const O = 'https://business.digitalburj.com';
let env: any; let ipn = 0;
const call = (path: string, init: RequestInit & { cookie?: string; origin?: string | null; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'cf-connecting-ip': `10.0.0.${ipn}`, ...(init.cookie ? { cookie: init.cookie } : {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json'; if (init.origin !== null && init.method && init.method !== 'GET') headers.origin = init.origin ?? O;
  return worker.fetch(new Request(O + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env);
};
const sess = (r: Response) => /(__Host-dbsess=[^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
const REG = (over: Record<string, unknown> = {}) => ({ legalName: 'Gulf Freight LLC', tradeName: 'GulfFreight', tradeLicense: 'DED-998877', licenseAuthority: 'Dubai DET (Mainland)', trn: '100123456700003', businessType: 'Freight forwarder', staffSize: '6–20', website: 'https://gulf.example', address: 'Office 12, Business Bay, Dubai', country: 'AE', city: 'Dubai', phone: '+97144001122', companyEmail: 'ops@gulf.example', name: 'Layla Hassan', jobTitle: 'Managing Director', email: 'layla@gulf.example', mobile: '+971501112233', password: 'Correct-horse-42', terms: true, ...over });
const register = async (over = {}) => { ipn++; return call('/api/register', { method: 'POST', body: REG(over) }); };
const as = async (email: string, password: string) => { ipn++; const r = await call('/api/login', { method: 'POST', body: { email, password } }); return { r, c: sess(r) }; };
beforeEach(() => { env = { DB: memoryD1() }; ipn = 0; });

describe('catalogue', () => {
  it('has all 40 sectors and 746 customer types; logistics is first and the only live sector', async () => {
    expect(SECTORS).toHaveLength(40); expect(SECTORS.reduce((n, s) => n + s.types.length, 0)).toBe(746); expect(SECTORS[0]!.name).toBe('Logistics & freight');
    const html = await (await call('/')).text(); expect(html.match(/class="card/g)).toHaveLength(40); expect(html.indexOf('data-no="1"')).toBeLessThan(html.indexOf('data-no="2"')); expect((html.match(/Live now/g) ?? []).length).toBe(1); expect(html).toContain('href="/logistics"');
    expect(await (await call('/api/sectors/14')).json()).toMatchObject({ name: 'Restaurants & food service' });
  });
});
describe('registration and sign-in', () => {
  it('registers a company with its owner, rejects bad details field by field, and refuses duplicates', async () => {
    const bad = await register({ legalName: '', trn: '123', phone: '0501', password: 'short', terms: false, businessType: 'Pizza' }); expect(bad.status).toBe(422); const f = (await bad.json()).fields; expect(Object.keys(f)).toEqual(expect.arrayContaining(['legalName', 'trn', 'phone', 'password', 'terms', 'businessType']));
    const ok = await register(); expect(ok.status).toBe(201); expect(ok.headers.get('set-cookie')).toMatch(/__Host-dbsess=.*HttpOnly.*SameSite=Lax.*Secure/);
    expect((await register()).status).toBe(409);
    const c = sess(ok)!; const dash = await call('/app', { cookie: c }); expect(dash.status).toBe(200); const t = await dash.text(); expect(t).toContain('Gulf Freight LLC'); expect(t).toContain('Owner');
  });
  it('stores only a salted PBKDF2 hash and a hashed session token', async () => {
    const r = await register(); const row: any = await env.DB.prepare('SELECT * FROM users').first(); expect(row.pw_hash).not.toContain('Correct'); expect(row.pw_iter).toBe(100000); expect(await verifyPassword('Correct-horse-42', row)).toBe(true); expect(await verifyPassword('wrong', row)).toBe(false);
    const s: any = await env.DB.prepare('SELECT id_hash FROM sessions').first(); expect(sess(r)).not.toContain(s.id_hash);
  });
  it('signs in with generic errors, locks after repeated failures, and signs out', async () => {
    await register(); expect((await as('layla@gulf.example', 'Correct-horse-42')).c).toBeTruthy();
    const a = await as('layla@gulf.example', 'nope'); const b = await as('ghost@x.example', 'nope'); expect(a.r.status).toBe(401); expect(await a.r.json()).toEqual(await b.r.json());     // no account enumeration
    for (let i = 0; i < 5; i++) await as('layla@gulf.example', 'nope'); const locked = await as('layla@gulf.example', 'Correct-horse-42'); expect(locked.r.status).toBe(429);
  });
  it('logout destroys the session', async () => {
    const c = sess(await register())!; const out = await call('/api/logout', { method: 'POST', cookie: c }); expect(out.status).toBe(303); expect((await call('/app', { cookie: c })).status).toBe(303);
  });
  it('refuses cross-site POSTs and unauthenticated access', async () => {
    expect((await call('/api/register', { method: 'POST', body: REG(), origin: 'https://evil.example' })).status).toBe(403); expect((await call('/api/register', { method: 'POST', body: REG(), origin: null })).status).toBe(403);
    expect((await call('/app')).status).toBe(303); expect((await call('/api/team/members', { method: 'POST', body: {} })).status).toBe(401); expect((await call('/api/company')).status).toBe(401);
  });
  it('rate-limits registrations per network', async () => {
    for (let i = 0; i < 5; i++) { const r = await call('/api/register', { method: 'POST', body: REG({ email: `u${i}@x.example` }) }); expect(r.status).toBe(201); }
    expect((await call('/api/register', { method: 'POST', body: REG({ email: 'u9@x.example' }) })).status).toBe(429);
  });
});
describe('role-based access (strict, server-enforced)', () => {
  async function team() {
    const owner = sess(await register())!; const add = async (role: string, email: string) => { const r = await call('/api/team/members', { method: 'POST', cookie: owner, body: { name: `${role} person`, email, role } }); expect(r.status).toBe(201); const { tempPassword } = await r.json(); const { c } = await as(email, tempPassword); return { c: c!, tempPassword }; };
    return { owner, add };
  }
  it('every role sees exactly the modules its permissions grant; unauthorised URLs return 403', async () => {
    const { owner, add } = await team();
    const sales = await add('sales', 's@x.example'); const fin = await add('accountant', 'a@x.example'); const wh = await add('warehouse_operator', 'w@x.example');
    for (const [who, role] of [[sales, 'sales'], [fin, 'accountant'], [wh, 'warehouse_operator']] as const) {
      await call('/api/password', { method: 'POST', cookie: who.c, body: { current: who.tempPassword, next: 'N3w-Strong-pass!' } });
      const html = await (await call('/app', { cookie: who.c })).text(); const allowed = modulesFor(role).map((m) => m.key);
      for (const m of MODULES) { const status = (await call(`/app/m/${m.key}`, { cookie: who.c })).status; expect(status, `${role}→${m.key}`).toBe(allowed.includes(m.key) ? 200 : 403); expect(html.includes(`href="/app/m/${m.key}"`), `${role} nav ${m.key}`).toBe(allowed.includes(m.key)); }
      expect((await call('/app/team', { cookie: who.c })).status).toBe(403); expect((await call('/api/team/members', { method: 'POST', cookie: who.c, body: { name: 'x y', email: 'q@x.example', role: 'sales' } })).status).toBe(403);
    }
    expect((await call('/app/m/finance', { cookie: sales.c })).status).toBe(403); expect((await call('/app/m/enquiries', { cookie: sales.c })).status).toBe(200); expect((await call('/app/m/finance', { cookie: owner })).status).toBe(200);
  });
  it('external portal roles only ever see the portal module; staff never see it', async () => {
    const { add } = await team(); const cust = await add('customer_portal', 'c@x.example'); await call('/api/password', { method: 'POST', cookie: cust.c, body: { current: cust.tempPassword, next: 'N3w-Strong-pass!' } });
    expect(modulesFor('customer_portal').map((m) => m.key)).toEqual(['portal']); expect((await call('/app/m/portal', { cookie: cust.c })).status).toBe(200); expect((await call('/app/m/finance', { cookie: cust.c })).status).toBe(403); expect((await call('/app/m/jobs', { cookie: cust.c })).status).toBe(403);
    expect(modulesFor('owner').some((m) => m.key === 'portal')).toBe(false); expect((await call('/app/audit', { cookie: cust.c })).status).toBe(403);
  });
  it('invited members must change the one-time password before anything else; role changes and disabling take effect immediately', async () => {
    const { owner, add } = await team(); const u = await add('sales', 's@x.example'); const redirected = await call('/app', { cookie: u.c }); expect(redirected.headers.get('location')).toBe('/app/password'); expect((await call('/api/company', { method: 'POST', cookie: u.c, body: {} })).status).toBe(403);
    expect((await call('/api/password', { method: 'POST', cookie: u.c, body: { current: u.tempPassword, next: 'short' } })).status).toBe(422);
    expect((await call('/api/password', { method: 'POST', cookie: u.c, body: { current: u.tempPassword, next: 'N3w-Strong-pass!' } })).status).toBe(200); expect((await call('/app/m/enquiries', { cookie: u.c })).status).toBe(200);
    const id = (await (env.DB.prepare('SELECT id FROM users WHERE email=?').bind('s@x.example').first() as Promise<any>)).id;
    expect((await call(`/api/team/members/${id}`, { method: 'PATCH', cookie: owner, body: { role: 'accountant' } })).status).toBe(200); expect((await call('/app/m/enquiries', { cookie: u.c })).status).toBe(303);           // old sessions are revoked
    const re = (await as('s@x.example', 'N3w-Strong-pass!')).c!; expect((await call('/app/m/finance', { cookie: re })).status).toBe(200); expect((await call('/app/m/enquiries', { cookie: re })).status).toBe(403);
    await call(`/api/team/members/${id}`, { method: 'PATCH', cookie: owner, body: { action: 'disable' } }); expect((await as('s@x.example', 'N3w-Strong-pass!')).r.status).toBe(401);
  });
  it('companies are isolated: a team admin cannot touch another company’s people, and cannot promote anyone to owner', async () => {
    const a = sess(await register())!; const b = sess(await register({ legalName: 'Other Logistics LLC', email: 'boss@other.example', tradeLicense: 'ZZ-1' }))!;
    const other: any = await env.DB.prepare("SELECT id FROM users WHERE email='boss@other.example'").first();
    expect((await call(`/api/team/members/${other.id}`, { method: 'PATCH', cookie: a, body: { action: 'disable' } })).status).toBe(404);
    const team = await (await call('/app/team', { cookie: a })).text(); expect(team).not.toContain('boss@other.example');
    expect((await call('/api/team/members', { method: 'POST', cookie: a, body: { name: 'Mallory X', email: 'm@x.example', role: 'owner' } })).status).toBe(422);
    const audit = await (await call('/app/audit', { cookie: b })).text(); expect(audit).toContain('Other Logistics LLC'); expect(audit).not.toContain('Gulf Freight LLC');
  });
  it('role catalogue comes from the Logistics OS permission model', () => { expect(ROLE_KEYS).toContain('customs_specialist'); expect(can('sales', 'invoices.post')).toBe(false); expect(can('finance_manager', 'invoices.approve')).toBe(true); });
});
describe('password policy', () => {
  it('rejects weak passwords and accepts strong ones', async () => { expect(passwordIssue('short1!')).toBeTruthy(); expect(passwordIssue('onlyletterslong')).toBeTruthy(); expect(passwordIssue('password123')).toBeTruthy(); expect(passwordIssue('Correct-horse-42', 'x@y.z')).toBeNull(); expect((await hashPassword('a')).iter).toBe(100000); });
});
