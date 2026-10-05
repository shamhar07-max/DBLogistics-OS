import express, { type Express } from 'express';
import { DiskStorage } from './storage';

/** Dev-only object endpoints for DiskStorage (signed + expiring). Mounted as plain middleware so it is not part of the public API contract. */
export function mountDevFiles(app: Express, storage: unknown) {
  if (!(storage instanceof DiskStorage)) return;
  const base = '/api/v1/dev-files';
  app.use(base, (req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS'); if (req.method === 'OPTIONS') { res.status(204).end(); return; } next(); });
  app.put(`${base}/:key`, express.raw({ type: () => true, limit: '55mb' }), async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (!storage.verify(key, 'PUT', Number(req.query.exp), String(req.query.sig ?? ''))) { res.status(403).end(); return; }
    await storage.put(key, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers['content-type'] ?? 'application/octet-stream')); res.status(200).end();
  });
  app.get(`${base}/:key`, async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (!storage.verify(key, 'GET', Number(req.query.exp), String(req.query.sig ?? ''))) { res.status(403).end(); return; }
    const f = await storage.get(key); if (!f) { res.status(404).end(); return; }
    res.setHeader('Content-Type', f.contentType); res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(f.body);
  });
}
