import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage, loadConfig, mountDevFiles } from '../src/platform';

const setup = () => { const cfg = loadConfig({ DEV_AUTH_SECRET: 'dev-secret-dev-secret-dev-secret-00', DEV_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'dbl-')) } as any); const s = new DiskStorage(cfg); const app = express(); mountDevFiles(app, s); return { s, app }; };
const path = (u: string) => u.replace('http://localhost:3001', '');

describe('local disk object store (development only)', () => {
  it('uploads and downloads through signed URLs; wrong method, tampered key, expiry and missing signature are refused', async () => {
    const { s, app } = setup(); const key = 't1/incoming/abc';
    const up = await s.presignUpload(key, 'application/pdf', 60); expect((await request(app).put(path(up)).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.4 hello'))).status).toBe(200);
    expect(await s.head(key)).toEqual({ size: 14 }); expect(await s.head('t1/incoming/missing')).toBeNull();
    const down = await s.presignDownload(key, 60); const r = await request(app).get(path(down)); expect(r.status).toBe(200); expect(r.headers['content-type']).toBe('application/pdf'); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.body.toString()).toBe('%PDF-1.4 hello');
    expect((await request(app).get(path(up))).status).toBe(403);                                               // an upload URL cannot download
    expect((await request(app).get(path(down).replace('abc', 'abd'))).status).toBe(403);                        // tampered key
    expect((await request(app).get(path(down).replace(/sig=[0-9a-f]+/, 'sig=00'))).status).toBe(403);
    expect((await request(app).get(path(await s.presignDownload(key, -5)))).status).toBe(403);                  // expired
    expect((await request(app).put(`/api/v1/dev-files/${encodeURIComponent(key)}`).send('x')).status).toBe(403);   // unsigned
  });
  it('stores objects at <dir>/<sha256(key)> — the worker scanner relies on this layout (same literal pinned in apps/worker/test)', () => {
    const { s } = setup(); expect((s as any).file('t1/incoming/abc').endsWith('/499a6a003dee3817acc4eecd02ad76cd1bb7859ac791faf29261d5db3b8887e9')).toBe(true);
  });
  it('is not mounted for the S3 adapter', () => { const app = express(); mountDevFiles(app, {}); return request(app).get('/api/v1/dev-files/x').expect(404); });
});
