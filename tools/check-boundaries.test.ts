import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './check-boundaries';

const mk = (files: Record<string, string>) => { const r = mkdtempSync(join(tmpdir(), 'bd-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), c); } return r; };
describe('architecture boundaries', () => {
  it('the real repository is clean', () => { expect(check(join(import.meta.dirname, '..'))).toEqual([]); });
  it('flags deep imports, platform→domain, browser→server and app→app', () => {
    const r = mk({
      'apps/api/src/finance/index.ts': 'export const x = 1;', 'apps/api/src/finance/application/s.ts': 'export const y = 1;',
      'apps/api/src/logistics/a.ts': "import { y } from '../finance/application/s';\nimport { x } from '../finance';",
      'apps/api/src/platform/p.ts': "import { x } from '../finance';",
      'packages/ui/src/c.ts': "import pg from 'pg';",
      'apps/staff-web/src/z.ts': "import { q } from '../../api/src/main';",
    });
    const rules = check(r).map((v) => v.rule);
    expect(rules).toEqual(expect.arrayContaining([expect.stringMatching(/deep import/), expect.stringMatching(/platform must not/), expect.stringMatching(/server code/), expect.stringMatching(/other apps/)]));
    expect(check(r).filter((v) => v.import === '../finance')).toHaveLength(1);   // public-index import from logistics is allowed; only platform's is flagged
  });
});
