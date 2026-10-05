import { describe, expect, it } from 'vitest';
import { createGateway } from './gateway';
import { COOKIE, seal, unseal } from './session';
import { loadGatewayEnv } from '@dbl/configuration';

const env = loadGatewayEnv({ SESSION_SECRET: 's'.repeat(40), DEV_AUTH_SECRET: 'dev-secret-dev-secret-dev-secret-00', API_BASE_URL: 'http://api.test' });
const calls: any[] = [];
const fake: typeof fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return String(url).endsWith('/me') ? new Response(JSON.stringify({ email: 'a@b', workspace: 'staff' }), { status: 200 }) : new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as any;
const gw = createGateway(env, fake);
const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];

describe('session gateway', () => {
  it('seals the session in an HttpOnly cookie and never exposes the access token to the browser', async () => {
    const r = await gw.devLogin(new Request('http://web.test/api/auth/dev-login', { method: 'POST', headers: { origin: 'http://web.test', host: 'web.test' }, body: JSON.stringify({ subject: 'layla', tenantId: 't1' }) }));
    expect(r.status).toBe(200); expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/); expect(JSON.stringify(await r.json())).not.toMatch(/token/i);
    const who = await gw.whoami(new Request('http://web.test/api/auth/me', { headers: { cookie: cookieOf(r) } })); const body = await who.json(); expect(body.csrf).toBeTruthy(); expect(JSON.stringify(body)).not.toMatch(/eyJ/);
  });
  it('proxy: attaches bearer + tenant, allows only /api/v1, and enforces same-origin + CSRF on mutations', async () => {
    const login = await gw.devLogin(new Request('http://web.test/x', { method: 'POST', headers: { origin: 'http://web.test', host: 'web.test' }, body: JSON.stringify({ subject: 'layla', tenantId: 't1' }) }));
    const cookie = cookieOf(login); const csrf = (await (await gw.whoami(new Request('http://web.test/x', { headers: { cookie } }))).json()).csrf;
    calls.length = 0;
    expect((await gw.proxy(new Request('http://web.test/api/proxy/api/v1/jobs', { headers: { cookie } }), ['api', 'v1', 'jobs'])).status).toBe(200);
    expect(calls[0].init.headers.get('authorization')).toMatch(/^Bearer /); expect(calls[0].init.headers.get('x-tenant-id')).toBe('t1');
    expect((await gw.proxy(new Request('http://web.test/x', { headers: { cookie } }), ['admin', 'secrets'])).status).toBe(404);
    const post = (h: Record<string, string>) => gw.proxy(new Request('http://web.test/x', { method: 'POST', headers: { cookie, host: 'web.test', ...h }, body: '{}' }), ['api', 'v1', 'quotes']);
    expect((await post({})).status).toBe(403); expect((await post({ origin: 'http://evil.test', 'x-csrf-token': csrf })).status).toBe(403); expect((await post({ origin: 'http://web.test' })).status).toBe(403);
    expect((await post({ origin: 'http://web.test', 'x-csrf-token': csrf, 'idempotency-key': 'k-12345678' })).status).toBe(200); expect(calls.at(-1).init.headers.get('idempotency-key')).toBe('k-12345678');
    expect((await gw.proxy(new Request('http://web.test/x'), ['api', 'v1', 'jobs'])).status).toBe(401);
  });
  it('tampered / foreign cookies are rejected; dev login is disabled in production', async () => {
    const good = await seal({ accessToken: 'x', accessExpiresAt: 0, tenantId: 't', user: { sub: 's' }, csrf: 'c' }, env.SESSION_SECRET);
    expect(await unseal(good, env.SESSION_SECRET)).not.toBeNull(); expect(await unseal(good, 'z'.repeat(40))).toBeNull(); expect(await unseal(good.slice(0, -3) + 'abc', env.SESSION_SECRET)).toBeNull();
    const prod = createGateway(loadGatewayEnv({ SESSION_SECRET: 's'.repeat(40), NODE_ENV: 'production', OIDC_ISSUER_URL: 'https://idp.test/realms/dbl', OIDC_WEB_CLIENT_ID: 'c', OIDC_WEB_CLIENT_SECRET: 's' }), fake);
    expect((await prod.devLogin(new Request('http://x/y', { method: 'POST', body: '{}' }))).status).toBe(404);
    void COOKIE;
  });
});
