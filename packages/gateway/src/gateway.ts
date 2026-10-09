import { SignJWT } from 'jose';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { loadGatewayEnv } from '@dbl/configuration';
import { clearCookie, COOKIE, readCookie, seal, setCookie, unseal, type Session } from './session';

type Env = ReturnType<typeof loadGatewayEnv>;
const b64u = (b: Buffer) => b.toString('base64url');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Session gateway (backend-for-frontend). Business validation stays in the API; the gateway only authenticates, holds tokens, and forwards. */
export function createGateway(env: Env, f: typeof fetch = fetch) {
  const secure = env.NODE_ENV === 'production';
  const apiUrl = env.API_BASE_URL.replace(/\/$/, '');
  const getSession = async (req: Request) => unseal(readCookie(req, COOKIE), env.SESSION_SECRET);
  const sameOrigin = (req: Request) => { const o = req.headers.get('origin'); if (!o) return false; try { return new URL(o).host === (req.headers.get('x-forwarded-host') ?? req.headers.get('host')); } catch { return false; } };
  const startSession = async (s: Omit<Session, 'csrf'>, redirect?: string) => {
    const sess: Session = { ...s, csrf: b64u(randomBytes(16)) }; const sealed = await seal(sess, env.SESSION_SECRET);
    const headers = new Headers({ 'Set-Cookie': setCookie(COOKIE, sealed, { secure }) });
    if (redirect) { headers.set('Location', redirect); return new Response(null, { status: 303, headers }); }
    headers.set('Content-Type', 'application/json'); return new Response(JSON.stringify({ ok: true, tenantId: s.tenantId }), { status: 200, headers });
  };

  return {
    getSession,
    /** Local development only (never available in production): mints an HS256 token for the API's DEV_AUTH_SECRET. */
    async devLogin(req: Request) {
      if (secure || !env.DEV_AUTH_SECRET) return json(404, { code: 'NOT_FOUND', message: 'Not found' });
      if (!sameOrigin(req)) return json(403, { code: 'FORBIDDEN', message: 'Cross-origin request refused' });
      const { subject, tenantId } = await req.json().catch(() => ({}));
      if (!subject || !tenantId) return json(422, { code: 'VALIDATION_FAILED', message: 'subject and tenantId required' });
      const token = await new SignJWT({ email: `${subject}@dev.local` }).setProtectedHeader({ alg: 'HS256' }).setSubject(subject).setAudience('dbl-api').setIssuedAt().setExpirationTime('8h').sign(new TextEncoder().encode(env.DEV_AUTH_SECRET));
      const me = await f(`${apiUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId } });
      if (!me.ok) return json(me.status, await me.json());
      const m = await me.json();
      return startSession({ accessToken: token, accessExpiresAt: Date.now() + 8 * 3600_000, tenantId, user: { sub: subject, email: m.email }, workspace: m.workspace });
    },
    /** OIDC authorization-code flow with PKCE (Keycloak in the reference stack). */
    async login(req: Request) {
      if (!env.OIDC_ISSUER_URL || !env.OIDC_WEB_CLIENT_ID || !env.OIDC_REDIRECT_URI) return json(501, { code: 'INTERNAL', message: 'OIDC not configured' });
      const disc = await (await f(`${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`)).json();
      const verifier = b64u(randomBytes(32)), state = b64u(randomBytes(16));
      const url = new URL(disc.authorization_endpoint);
      Object.entries({ response_type: 'code', client_id: env.OIDC_WEB_CLIENT_ID, redirect_uri: env.OIDC_REDIRECT_URI, scope: 'openid profile email', state, code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' }).forEach(([k, v]) => url.searchParams.set(k, v));
      const tmp = await seal({ accessToken: verifier, accessExpiresAt: 0, tenantId: state, user: { sub: '' }, csrf: '' }, env.SESSION_SECRET, 600);
      return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': setCookie('dbl_oidc', tmp, { secure, maxAge: 600 }) } });
    },
    async callback(req: Request) {
      const u = new URL(req.url); const tmp = await unseal(readCookie(req, 'dbl_oidc'), env.SESSION_SECRET);
      if (!tmp || tmp.tenantId !== u.searchParams.get('state') || !u.searchParams.get('code')) return json(400, { code: 'UNAUTHENTICATED', message: 'Invalid login state' });
      const disc = await (await f(`${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`)).json();
      const tok = await f(disc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code')!, redirect_uri: env.OIDC_REDIRECT_URI!, client_id: env.OIDC_WEB_CLIENT_ID!, client_secret: env.OIDC_WEB_CLIENT_SECRET!, code_verifier: tmp.accessToken }) });
      if (!tok.ok) return json(401, { code: 'UNAUTHENTICATED', message: 'Token exchange failed' });
      const t = await tok.json();
      const ms = await (await f(`${apiUrl}/api/v1/me/memberships`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
      if (!Array.isArray(ms) || !ms.length) return json(403, { code: 'FORBIDDEN', message: 'No tenant membership' });
      const res = await startSession({ accessToken: t.access_token, refreshToken: t.refresh_token, accessExpiresAt: Date.now() + (t.expires_in ?? 300) * 1000, tenantId: ms[0].tenant_id, user: { sub: 'oidc' }, workspace: ms[0].workspace }, '/');
      res.headers.append('Set-Cookie', clearCookie('dbl_oidc', secure)); return res;
    },
    async logout() { return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': clearCookie(COOKIE, secure) } }); },
    /** Forwards ONLY /api/v1/* to the API with the session's bearer + tenant. Mutations require same-origin + the CSRF header. */
    async proxy(req: Request, pathSegments: string[]) {
      const s = await getSession(req); if (!s) return json(401, { code: 'UNAUTHENTICATED', message: 'Sign in required.', requestId: 'gw' });
      const path = '/' + pathSegments.join('/'); if (!path.startsWith('/api/v1/')) return json(404, { code: 'NOT_FOUND', message: 'Not found', requestId: 'gw' });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (!sameOrigin(req) || req.headers.get('x-csrf-token') !== s.csrf) return json(403, { code: 'FORBIDDEN', message: 'CSRF check failed', requestId: 'gw' });
      }
      const h = new Headers({ Authorization: `Bearer ${s.accessToken}`, 'X-Tenant-Id': s.tenantId, 'X-Request-Id': `req_${randomUUID().slice(0, 12)}` });
      for (const k of ['content-type', 'idempotency-key', 'if-match', 'accept']) { const v = req.headers.get(k); if (v) h.set(k, v); }
      const url = new URL(req.url);
      const up = await f(`${apiUrl}${path}${url.search}`, { method: req.method, headers: h, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text() });
      const headers: Record<string, string> = { 'Content-Type': up.headers.get('content-type') ?? 'application/json', 'X-Request-Id': up.headers.get('x-request-id') ?? '' };
      const cd = up.headers.get('content-disposition'); if (cd) headers['Content-Disposition'] = cd;
      return new Response(await up.arrayBuffer(), { status: up.status, headers });          // bytes, not text: PDFs and other binaries pass through intact
    },
    /** Safe, non-secret view for the browser: who am I, which tenant, CSRF token. */
    async whoami(req: Request) {
      const s = await getSession(req);
      const rejected = () => json(401, { code: 'UNAUTHENTICATED', message: 'Sign in required.' }, { 'Set-Cookie': clearCookie(COOKIE, secure), 'Cache-Control': 'no-store' });
      if (!s || s.accessExpiresAt <= Date.now()) return rejected();
      try {
        const me = await f(`${apiUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${s.accessToken}`, 'X-Tenant-Id': s.tenantId }, signal: AbortSignal.timeout(5000) });
        if (me.status === 401 || me.status === 403) return rejected();
        if (!me.ok) return json(503, { code: 'INTERNAL', message: 'Identity service unavailable.' });
        const current = await me.json();
        return json(200, { user: s.user, tenantId: s.tenantId, workspace: current.workspace, csrf: s.csrf }, { 'Cache-Control': 'no-store' });
      } catch { return json(503, { code: 'INTERNAL', message: 'Identity service unavailable.' }); }
    },
  };
}
