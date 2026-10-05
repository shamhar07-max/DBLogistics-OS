import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from './index';

describe('api-client', () => {
  it('builds path, headers, idempotency and surfaces structured errors', async () => {
    const seen: any[] = [];
    const fake = (async (url: string, init: any) => { seen.push({ url, init }); return url.includes('/post') ? new Response(JSON.stringify({ code: 'ACCOUNTING_PERIOD_CLOSED', message: 'closed', requestId: 'req_1' }), { status: 422 }) : new Response('{"ok":true}', { status: 200 }); }) as any;
    const c = createClient({ baseUrl: 'http://api', tenantId: 't-1', getToken: () => 'tok', fetch: fake });
    await c.call('getJob', { params: { id: 'abc' } });
    expect(seen[0].url).toBe('http://api/api/v1/jobs/abc'); expect(seen[0].init.headers['X-Tenant-Id']).toBe('t-1'); expect(seen[0].init.headers.Authorization).toBe('Bearer tok');
    await expect(c.call('postInvoice', { params: { id: 'i1' }, body: { postingDate: '2026-10-05' }, ifMatch: 7 })).rejects.toBeInstanceOf(ApiError);
    expect(seen[1].init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/); expect(seen[1].init.headers['If-Match']).toBe('"7"');
    try { await c.call('postInvoice', { params: { id: 'i1' }, body: { postingDate: '2026-10-05' } }); } catch (e: any) { expect(e.code).toBe('ACCOUNTING_PERIOD_CLOSED'); expect(e.status).toBe(422); }
  });
});
