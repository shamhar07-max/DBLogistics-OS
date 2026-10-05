/** Architecture guard (run in CI): modules talk only through each other's public index; platform never depends on domain
 *  modules; browser packages never import server code; apps never import other apps. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';

const walk = (d: string): string[] => (!existsSync(d) ? [] : readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f === 'dist' || f === '.next' ? [] : statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; }));
const importsOf = (src: string) => [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
export interface Violation { file: string; import: string; rule: string }

export function check(root: string): Violation[] {
  const out: Violation[] = []; const api = join(root, 'apps/api/src');
  for (const f of walk(api)) {
    const rel = relative(api, f).split(sep); const own = rel.length > 1 ? rel[0] : '(root)';
    if (own === '(root)') continue;                                   // app.module.ts / main.ts / provisioning.ts compose modules
    for (const i of importsOf(readFileSync(f, 'utf8'))) {
      if (!i.startsWith('.')) continue;
      const target = relative(api, resolve(dirname(f), i)).split(sep); const mod = target[0];
      if (mod === '..' || mod === own || mod === 'platform' && own !== 'platform') { if (mod === '..') out.push({ file: relative(root, f), import: i, rule: 'escapes apps/api/src' }); continue; }
      if (own === 'platform') { out.push({ file: relative(root, f), import: i, rule: 'platform must not depend on domain modules' }); continue; }
      if (target.length > 1 && !(target.length === 2 && target[1] === 'index')) out.push({ file: relative(root, f), import: i, rule: `deep import into module "${mod}" — use its public index` });
    }
  }
  for (const pkg of ['ui', 'api-client', 'design-tokens', 'localization', 'contracts', 'offline-sync', 'configuration'])
    for (const f of walk(join(root, 'packages', pkg, 'src'))) for (const i of importsOf(readFileSync(f, 'utf8')))
      if (/^(pg|@nestjs\/|bullmq|ioredis|@aws-sdk)/.test(i) || /apps\/(api|worker)/.test(i)) out.push({ file: relative(root, f), import: i, rule: 'shared/browser package must not import server code' });
  for (const app of ['api', 'worker', 'staff-web', 'partner-portal'])
    for (const f of walk(join(root, 'apps', app))) for (const i of importsOf(readFileSync(f, 'utf8'))) {
      if (!i.startsWith('.')) continue;
      const m = /^apps\/([^/]+)/.exec(relative(root, resolve(dirname(f), i)).split(sep).join('/'));
      if (m && m[1] !== app) out.push({ file: relative(root, f), import: i, rule: `apps must not import other apps (${m[1]})` });
    }
  return out;
}
if (process.argv[1]?.endsWith('check-boundaries.ts')) {
  const v = check(resolve(import.meta.dirname ?? '.', '..'));
  if (v.length) { console.error(v.map((x) => `${x.file}: "${x.import}" — ${x.rule}`).join('\n')); process.exit(1); }
  console.log('architecture boundaries OK');
}
