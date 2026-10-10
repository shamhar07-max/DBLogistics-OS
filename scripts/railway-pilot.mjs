import http from 'node:http';
import { spawn } from 'node:child_process';
import { targetFor } from './railway-pilot-routing.mjs';

// One public listener; the authenticated API is reachable only through the web BFF.
if (process.env.PORTAL_HOST && (!process.env.PORTAL_OIDC_CLIENT_ID || !process.env.PORTAL_OIDC_CLIENT_SECRET || !process.env.PORTAL_SESSION_SECRET)) throw new Error('Portal requires its own OIDC credentials and session secret');
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000).unref();
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
}
function start(args, cwd, memory, extra = {}) {
  const child = spawn(process.execPath, [`--max-old-space-size=${memory}`, ...args], {
    cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', RAILWAY_FREE_PILOT: 'true', API_BASE_URL: 'http://127.0.0.1:3101', ...extra },
  });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', () => { if (!stopping) stop(1); });
}
async function ready() {
  const ports = [3100, 3101, ...(process.env.PORTAL_HOST ? [3102] : [])];
  const checks = await Promise.all(ports.map(async port => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/${port === 3101 ? 'api/v1/health/ready' : 'api/health'}`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      // A Next 404 still proves its HTTP listener is ready. API must confirm DB readiness.
      await response.body?.cancel();
      return port === 3101 ? response.ok : response.status < 500;
    } catch { return false; }
  }));
  return checks.every(Boolean);
}
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') {
    const ok = await ready();
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ready: ok })); return;
  }
  const host = req.headers.host || '';
  const upstream = http.request({ hostname: '127.0.0.1', port: targetFor(host, req.url, process.env.PORTAL_HOST), path: req.url, method: req.method,
    headers: { ...req.headers, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress || '' },
  }, response => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
  upstream.setTimeout(60000, () => upstream.destroy());
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Service starting or unavailable'); });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
});
server.on('error', error => { console.error(error.message); stop(1); });
start(['apps/api/dist/main.js'], '/repo', 96, { PORT: '3101' });
start(['/repo/node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3100'], '/repo/apps/staff-web', 160);
if (process.env.PORTAL_HOST) {
  start(['/repo/node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3102'], '/repo/apps/partner-portal', 112, {
    OIDC_WEB_CLIENT_ID: process.env.PORTAL_OIDC_CLIENT_ID, OIDC_WEB_CLIENT_SECRET: process.env.PORTAL_OIDC_CLIENT_SECRET,
    SESSION_SECRET: process.env.PORTAL_SESSION_SECRET, OIDC_REDIRECT_URI: `https://${process.env.PORTAL_HOST}/api/auth/callback`,
  });
}
server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
