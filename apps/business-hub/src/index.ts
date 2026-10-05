import type { D1, Env, Session } from './types';
import { hashPassword, passwordIssue, randomToken, sha256, SECURITY_HEADERS, verifyPassword } from './security';
import { INVITABLE_ROLES, can, moduleFor } from './roles';
import { AUTHORITIES, COUNTRIES, SECTORS, STAFF_SIZES, LIVE_SECTOR, accountPage, auditPage, authPage, companyPage, dashboard, forbidden, landing, modulePage, notFound, teamPage } from './ui';

const SESSION_IDLE = 8 * 3600, SESSION_MAX = 7 * 86400, MAX_BODY = 20_000;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clientIp = (r: Request) => r.headers.get('cf-connecting-ip') ?? '0.0.0.0';
const html = (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra } });
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra } });
const redirect = (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra } });
const cookieName = (url: URL) => (url.protocol === 'https:' ? '__Host-dbsess' : 'dbsess');
const cookie = (url: URL, value: string, maxAge: number) => `${cookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
const getCookie = (r: Request, name: string) => r.headers.get('cookie')?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

// ---- throttling (login: per email and per IP; registration: per IP) ----
async function throttled(db: D1, key: string): Promise<boolean> {
  const t = Math.floor(Date.now() / 1000); const r = await db.prepare('SELECT locked_until FROM throttle WHERE k=?').bind(key).first<{ locked_until: number }>();
  return !!r && r.locked_until > t;
}
async function hit(db: D1, key: string, limit: number, windowS: number, lockS: number) {
  const t = Math.floor(Date.now() / 1000); const r = await db.prepare('SELECT n, window_start FROM throttle WHERE k=?').bind(key).first<{ n: number; window_start: number }>();
  const fresh = !r || t - r.window_start > windowS; const n = fresh ? 1 : r!.n + 1; const ws = fresh ? t : r!.window_start;
  await db.prepare('INSERT INTO throttle(k,n,window_start,locked_until) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET n=excluded.n, window_start=excluded.window_start, locked_until=excluded.locked_until').bind(key, n, ws, n >= limit ? t + lockS : 0).run();
}
const clear = (db: D1, key: string) => db.prepare('DELETE FROM throttle WHERE k=?').bind(key).run();
const audit = (db: D1, tenantId: string, userId: string | null, action: string, detail: string, ip: string) => db.prepare('INSERT INTO audit(tenant_id,user_id,action,detail,ip,at) VALUES(?,?,?,?,?,?)').bind(tenantId, userId, action, detail.slice(0, 300), ip, now()).run();

// ---- sessions ----
async function startSession(env: Env, req: Request, url: URL, userId: string) {
  const token = randomToken(32); const t = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at,absolute_expires_at,ip,ua) VALUES(?,?,?,?,?,?,?)').bind(await sha256(token), userId, t, t + SESSION_IDLE, t + SESSION_MAX, clientIp(req), (req.headers.get('user-agent') ?? '').slice(0, 200)).run();
  return cookie(url, token, SESSION_IDLE);
}
async function sessionOf(env: Env, req: Request, url: URL): Promise<Session | null> {
  const token = getCookie(req, cookieName(url)); if (!token) return null; const h = await sha256(token); const t = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare(`SELECT s.expires_at, s.absolute_expires_at, u.id uid, u.tenant_id, u.role, u.name, u.email, u.status, u.must_change, t.legal_name, t.status tstatus FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.id_hash=?`).bind(h).first<any>();
  if (!r || r.expires_at < t || r.absolute_expires_at < t || r.status !== 'active' || r.tstatus !== 'active') return null;
  if (r.expires_at - t < SESSION_IDLE - 600) await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE id_hash=?').bind(Math.min(t + SESSION_IDLE, r.absolute_expires_at), h).run();   // sliding window, capped
  return { userId: r.uid, tenantId: r.tenant_id, role: r.role, name: r.name, email: r.email, mustChange: !!r.must_change, company: r.legal_name, sessionHash: h };
}

// ---- validation ----
type Fields = Record<string, string>;
const str = (b: any, k: string, max: number) => (typeof b?.[k] === 'string' ? b[k].trim().replace(/\s+/g, ' ').slice(0, max) : '');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
const normPhone = (p: string) => p.replace(/[\s()-]/g, '');
function validateRegistration(b: any) {
  const e: Fields = {}; const v = {
    legalName: str(b, 'legalName', 160), tradeName: str(b, 'tradeName', 120), tradeLicense: str(b, 'tradeLicense', 60), licenseAuthority: str(b, 'licenseAuthority', 80), trn: str(b, 'trn', 15).replace(/\s/g, ''), businessType: str(b, 'businessType', 80), staffSize: str(b, 'staffSize', 20),
    website: str(b, 'website', 120), address: str(b, 'address', 300), country: str(b, 'country', 8), city: str(b, 'city', 80), phone: normPhone(str(b, 'phone', 24)), companyEmail: str(b, 'companyEmail', 120).toLowerCase(), name: str(b, 'name', 120), jobTitle: str(b, 'jobTitle', 80),
    email: str(b, 'email', 120).toLowerCase(), mobile: normPhone(str(b, 'mobile', 24)), password: typeof b?.password === 'string' ? b.password : '',
  };
  if (v.legalName.length < 2) e.legalName = 'Enter the registered company name.';
  if (v.tradeLicense.length < 3) e.tradeLicense = 'Enter the trade licence number.';
  if (!AUTHORITIES.includes(v.licenseAuthority)) e.licenseAuthority = 'Choose the licensing authority.';
  if (!SECTORS[0]!.types.some((t) => t.name === v.businessType)) e.businessType = 'Choose your type of business.';
  if (v.staffSize && !STAFF_SIZES.includes(v.staffSize)) e.staffSize = 'Choose a team size.';
  if (v.trn && !/^\d{15}$/.test(v.trn)) e.trn = 'A TRN has 15 digits.';
  if (v.website && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v.website)) e.website = 'Enter a full web address starting with https://';
  if (v.address.length < 6) e.address = 'Enter the registered address.';
  if (!COUNTRIES.some(([c]) => c === v.country)) e.country = 'Choose a country.';
  if (v.city.length < 2) e.city = 'Enter the city or emirate.';
  if (!PHONE.test(v.phone)) e.phone = 'Use international format, e.g. +971501234567.';
  if (v.companyEmail && !EMAIL.test(v.companyEmail)) e.companyEmail = 'Enter a valid email address.';
  if (v.name.length < 2) e.name = 'Enter your full name.';
  if (!EMAIL.test(v.email)) e.email = 'Enter a valid work email.';
  if (!PHONE.test(v.mobile)) e.mobile = 'Use international format, e.g. +971501234567.';
  const pw = passwordIssue(v.password, v.email); if (pw) e.password = pw;
  if (b?.terms !== true) e.terms = 'Please confirm to continue.';
  return { e, v };
}

async function readJson(req: Request): Promise<any | null> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return null;
  const txt = await req.text(); if (txt.length > MAX_BODY) return null; try { return JSON.parse(txt); } catch { return null; }
}
const sameOrigin = (req: Request, url: URL) => { const o = req.headers.get('origin'); if (!o) return false; try { return new URL(o).host === url.host; } catch { return false; } };
const tempPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(14)); return Array.from(r, (x) => a[x % a.length]).join('') + '#7'; };

async function register(env: Env, req: Request, url: URL) {
  const ip = clientIp(req); const b = await readJson(req); if (!b) return json({ error: 'Invalid request.' }, 400);
  if (await throttled(env.DB, `reg:${ip}`)) return json({ error: 'Too many registrations from this network. Please try again later.' }, 429);
  const { e, v } = validateRegistration(b); if (Object.keys(e).length) return json({ error: 'Please correct the highlighted fields.', fields: e }, 422);
  if (await env.DB.prepare('SELECT 1 x FROM users WHERE email=?').bind(v.email).first()) return json({ error: 'An account with this email already exists. Sign in instead.', fields: { email: 'Already registered.' } }, 409);
  await hit(env.DB, `reg:${ip}`, 5, 3600, 3600);
  const tid = uuid(), uid = uuid(), t = now(); const pw = await hashPassword(v.password);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO tenants(id,sector,legal_name,trade_name,trade_license,license_authority,trn,business_type,country,city,address,phone,email,website,staff_size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(tid, LIVE_SECTOR, v.legalName, v.tradeName || null, v.tradeLicense, v.licenseAuthority, v.trn || null, v.businessType, v.country, v.city, v.address, v.phone, v.companyEmail || null, v.website || null, v.staffSize || null, t, t),
    env.DB.prepare('INSERT INTO users(id,tenant_id,email,name,job_title,phone,role,must_change,pw_hash,pw_salt,pw_iter,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uid, tid, v.email, v.name, v.jobTitle || null, v.mobile, 'owner', 0, pw.hash, pw.salt, pw.iter, t, t),
    env.DB.prepare('INSERT INTO audit(tenant_id,user_id,action,detail,ip,at) VALUES(?,?,?,?,?,?)').bind(tid, uid, 'company.registered', v.legalName, ip, t),
  ]);
  return json({ ok: true, next: '/app' }, 201, { 'set-cookie': await startSession(env, req, url, uid) });
}
async function login(env: Env, req: Request, url: URL) {
  const ip = clientIp(req); const b = await readJson(req); const email = str(b, 'email', 120).toLowerCase(); const password = typeof b?.password === 'string' ? b.password.slice(0, 128) : '';
  const ek = `login:e:${email}`, ik = `login:i:${ip}`;
  if (!email || !password) return json({ error: 'Enter your email and password.' }, 400);
  if ((await throttled(env.DB, ek)) || (await throttled(env.DB, ik))) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
  const u = await env.DB.prepare('SELECT u.*, t.status tstatus FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=?').bind(email).first<any>();
  const ok = u ? await verifyPassword(password, u) : (await hashPassword(password), false);          // equal work for unknown emails
  if (!u || !ok || u.status !== 'active' || u.tstatus !== 'active') { await hit(env.DB, ek, 5, 900, 900); await hit(env.DB, ik, 20, 900, 900); if (u) await audit(env.DB, u.tenant_id, u.id, 'login.failed', '', ip); return json({ error: 'Email or password is incorrect.' }, 401); }
  await clear(env.DB, ek); await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), u.id).run(); await audit(env.DB, u.tenant_id, u.id, 'login', '', ip);
  return json({ ok: true, next: u.must_change ? '/app/password' : '/app' }, 200, { 'set-cookie': await startSession(env, req, url, u.id) });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url); const path = url.pathname.replace(/\/+$/, '') || '/'; const m = req.method;
    try {
      // brand assets are served from the DigitalBurj main site so this app always shows the current master files
      if ((m === 'GET' || m === 'HEAD') && /^\/(brand|industry|media)\/[\w.-]+$/.test(path)) {
        const r = await fetch(`${env.BRAND_ORIGIN ?? 'https://digitalburj.com'}${path}`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
        return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
      }
      if (m === 'GET' && path === '/') return html(landing(), 200, { 'cache-control': 'public, max-age=300' });
      if (m === 'GET' && path === '/healthz') return json({ ok: true });
      const sm = /^\/api\/sectors\/(\d+)$/.exec(path); if (m === 'GET' && sm) { const s = SECTORS.find((x) => x.no === Number(sm[1])); return s ? json(s, 200, { 'cache-control': 'public, max-age=3600' }) : json({ error: 'Not found' }, 404); }
      if (m === 'GET' && path === '/logistics') return html(authPage('login'));
      if (m === 'GET' && path === '/robots.txt') return new Response('User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\n', { headers: { 'content-type': 'text/plain' } });

      if (m !== 'GET' && m !== 'HEAD' && !sameOrigin(req, url)) return json({ error: 'Cross-site request refused.' }, 403);
      if (m === 'POST' && path === '/api/register') return await register(env, req, url);
      if (m === 'POST' && path === '/api/login') return await login(env, req, url);
      if (m === 'POST' && path === '/api/logout') { const s = await sessionOf(env, req, url); if (s) { await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(s.sessionHash).run(); await audit(env.DB, s.tenantId, s.userId, 'logout', '', clientIp(req)); } return redirect('/logistics', { 'set-cookie': cookie(url, '', 0) }); }

      const wantsPage = path === '/app' || path.startsWith('/app/'); const wantsApi = path.startsWith('/api/');
      if (wantsPage || wantsApi) {
        const s = await sessionOf(env, req, url);
        if (!s) return wantsApi ? json({ error: 'Please sign in.' }, 401) : redirect('/logistics', { 'set-cookie': cookie(url, '', 0) });
        const links = { os: env.LOGISTICS_OS_URL, portal: env.PORTAL_URL };
        if (s.mustChange && path !== '/app/password' && path !== '/api/password') return wantsApi ? json({ error: 'Change your password first.' }, 403) : redirect('/app/password');
        if (m === 'GET' && path === '/app/password') return html(accountPage(s, true));
        if (m === 'GET' && path === '/app') return html(dashboard(s, links));
        const mm = /^\/app\/m\/([a-z]+)$/.exec(path); if (m === 'GET' && mm) { const mod = moduleFor(s.role, mm[1]!); return mod ? html(modulePage(s, mod, links)) : html(forbidden(s, links), 403); }
        if (m === 'GET' && path === '/app/account') return html(accountPage(s, false, links));
        if (m === 'GET' && path === '/app/company') { const t = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(s.tenantId).first(); return html(companyPage(s, t!, links)); }
        if (m === 'GET' && path === '/app/team') { if (!can(s.role, 'admin.tenant')) return html(forbidden(s, links), 403); const r = await env.DB.prepare('SELECT id,name,email,job_title,role,status,must_change FROM users WHERE tenant_id=? ORDER BY created_at').bind(s.tenantId).all(); return html(teamPage(s, r.results, INVITABLE_ROLES, links)); }
        if (m === 'GET' && path === '/app/audit') { if (!can(s.role, 'audit.view') && !can(s.role, 'admin.tenant')) return html(forbidden(s, links), 403); const r = await env.DB.prepare('SELECT a.at,a.action,a.detail,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 200').bind(s.tenantId).all(); return html(auditPage(s, r.results, links)); }

        if (m === 'POST' && path === '/api/password') {
          const b = await readJson(req); const cur = typeof b?.current === 'string' ? b.current : '', next = typeof b?.next === 'string' ? b.next : '';
          const k = `pw:${s.userId}`; if (await throttled(env.DB, k)) return json({ error: 'Too many attempts. Wait 15 minutes.' }, 429);
          const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(s.userId).first<any>(); if (!u || !(await verifyPassword(cur, u))) { await hit(env.DB, k, 5, 900, 900); return json({ error: 'Your current password is not correct.' }, 400); }
          const issue = passwordIssue(next, s.email); if (issue) return json({ error: issue }, 422); if (next === cur) return json({ error: 'Choose a different password from the current one.' }, 422);
          const pw = await hashPassword(next);
          await env.DB.batch([env.DB.prepare('UPDATE users SET pw_hash=?,pw_salt=?,pw_iter=?,must_change=0 WHERE id=?').bind(pw.hash, pw.salt, pw.iter, s.userId), env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id_hash<>?').bind(s.userId, s.sessionHash)]);
          await clear(env.DB, k); await audit(env.DB, s.tenantId, s.userId, 'password.changed', '', clientIp(req)); return json({ ok: true });
        }
        if (m === 'POST' && path === '/api/company') {
          if (!can(s.role, 'admin.tenant')) return json({ error: 'Only the company owner can edit the company profile.' }, 403);
          const b = await readJson(req); if (!b) return json({ error: 'Invalid request.' }, 400); const f = { legalName: str(b, 'legalName', 160), tradeName: str(b, 'tradeName', 120), tradeLicense: str(b, 'tradeLicense', 60), trn: str(b, 'trn', 15), address: str(b, 'address', 300), city: str(b, 'city', 80), phone: normPhone(str(b, 'phone', 24)), companyEmail: str(b, 'companyEmail', 120).toLowerCase(), website: str(b, 'website', 120) };
          if (f.legalName.length < 2 || f.tradeLicense.length < 3 || f.address.length < 6 || f.city.length < 2) return json({ error: 'Name, licence, address and city are required.' }, 422);
          if (f.trn && !/^\d{15}$/.test(f.trn)) return json({ error: 'A TRN has 15 digits.' }, 422); if (!PHONE.test(f.phone)) return json({ error: 'Use an international phone number, e.g. +971…' }, 422); if (f.companyEmail && !EMAIL.test(f.companyEmail)) return json({ error: 'Enter a valid company email.' }, 422);
          await env.DB.prepare('UPDATE tenants SET legal_name=?,trade_name=?,trade_license=?,trn=?,address=?,city=?,phone=?,email=?,website=?,updated_at=? WHERE id=?').bind(f.legalName, f.tradeName || null, f.tradeLicense, f.trn || null, f.address, f.city, f.phone, f.companyEmail || null, f.website || null, now(), s.tenantId).run();
          await audit(env.DB, s.tenantId, s.userId, 'company.updated', f.legalName, clientIp(req)); return json({ ok: true });
        }
        if (path.startsWith('/api/team')) {
          if (!can(s.role, 'admin.tenant')) return json({ error: 'Only the company owner can manage the team.' }, 403);
          if (m === 'POST' && path === '/api/team/members') {
            const b = await readJson(req); const name = str(b, 'name', 120), email = str(b, 'email', 120).toLowerCase(), role = str(b, 'role', 40), jobTitle = str(b, 'jobTitle', 80);
            if (name.length < 2 || !EMAIL.test(email)) return json({ error: 'Enter the person’s name and a valid email.' }, 422); if (!INVITABLE_ROLES.includes(role)) return json({ error: 'Choose a role.' }, 422);
            if (await env.DB.prepare('SELECT 1 x FROM users WHERE email=?').bind(email).first()) return json({ error: 'That email already has an account.' }, 409);
            const temp = tempPassword(), pw = await hashPassword(temp), id = uuid();
            await env.DB.prepare('INSERT INTO users(id,tenant_id,email,name,job_title,role,must_change,pw_hash,pw_salt,pw_iter,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, s.tenantId, email, name, jobTitle || null, role, 1, pw.hash, pw.salt, pw.iter, now(), s.userId).run();
            await audit(env.DB, s.tenantId, s.userId, 'member.added', `${email} as ${role}`, clientIp(req)); return json({ ok: true, id, tempPassword: temp }, 201);
          }
          const tm = /^\/api\/team\/members\/([\w-]+)$/.exec(path);
          if (m === 'PATCH' && tm) {
            const b = await readJson(req); const u = await env.DB.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').bind(tm[1], s.tenantId).first<any>();          // tenant-scoped: another company's user id is simply "not found"
            if (!u) return json({ error: 'Member not found.' }, 404); if (u.id === s.userId || u.role === 'owner') return json({ error: 'The owner account cannot be changed here.' }, 403);
            if (typeof b?.role === 'string') { if (!INVITABLE_ROLES.includes(b.role)) return json({ error: 'Unknown role.' }, 422); await env.DB.batch([env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(b.role, u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]); await audit(env.DB, s.tenantId, s.userId, 'member.role', `${u.email}: ${u.role} → ${b.role}`, clientIp(req)); return json({ ok: true }); }
            if (b?.action === 'disable' || b?.action === 'enable') { await env.DB.batch([env.DB.prepare('UPDATE users SET status=? WHERE id=?').bind(b.action === 'disable' ? 'disabled' : 'active', u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]); await audit(env.DB, s.tenantId, s.userId, `member.${b.action}`, u.email, clientIp(req)); return json({ ok: true }); }
            if (b?.action === 'reset') { const temp = tempPassword(), pw = await hashPassword(temp); await env.DB.batch([env.DB.prepare('UPDATE users SET pw_hash=?,pw_salt=?,pw_iter=?,must_change=1 WHERE id=?').bind(pw.hash, pw.salt, pw.iter, u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]); await audit(env.DB, s.tenantId, s.userId, 'member.reset', u.email, clientIp(req)); return json({ ok: true, tempPassword: temp }); }
            return json({ error: 'Nothing to change.' }, 400);
          }
        }
        return wantsApi ? json({ error: 'Not found' }, 404) : html(notFound(), 404);
      }
      return html(notFound(), 404);
    } catch (err) {
      console.error('unhandled', (err as Error)?.message);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
