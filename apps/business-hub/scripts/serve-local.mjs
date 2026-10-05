// Local preview: runs the Worker against an in-memory SQLite D1 shim. Usage: npx tsx scripts/serve-local.mjs
import http from 'node:http';
import worker from '../src/index.ts';
import { memoryD1 } from '../test/d1.ts';
const env = { DB: memoryD1(), BRAND_ORIGIN: 'http://127.0.0.1:9' };
http.createServer(async (q, s) => { const chunks = []; for await (const c of q) chunks.push(c); const url = `http://localhost:8787${q.url}`;
  const r = await worker.fetch(new Request(url, { method: q.method, headers: q.headers, body: ['GET', 'HEAD'].includes(q.method) ? undefined : Buffer.concat(chunks) }), env);
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); const sc = r.headers.get('set-cookie'); if (sc) h['set-cookie'] = sc.replace('__Host-', '');
  s.writeHead(r.status, h); s.end(Buffer.from(await r.arrayBuffer())); }).listen(8787, () => console.log('http://localhost:8787'));
