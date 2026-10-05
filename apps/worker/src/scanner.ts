import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanPort } from './handlers';

/** The EICAR antivirus test signature (harmless; every scanner must flag it). */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
/** Must match the API's DiskStorage layout (`apps/api/src/platform/storage.ts`): <dir>/<sha256(key)>. Both sides are pinned to the same literal by tests. */
export const diskPath = (dir: string, key: string) => join(dir, createHash('sha256').update(key).digest('hex'));

/** Scanner for development with the local-disk object store: signature check on the stored bytes. A file that cannot be read is NOT clean — it is 'failed'. */
export class DiskScanner implements ScanPort {
  constructor(private dir: string) {}
  async scan(storageKey: string) {
    try { const b = await readFile(diskPath(this.dir, storageKey)); return b.includes(EICAR) ? 'infected' as const : 'clean' as const; } catch { return 'failed' as const; }
  }
}
/** Fail closed: with no scanner configured, nothing is ever marked clean. */
export const unconfiguredScanner: ScanPort = { async scan() { return 'failed'; } };

export function pickScanner(env: Record<string, string | undefined> = process.env): { scanner: ScanPort; name: string } {
  if (env.DEV_STORAGE_DIR) return { scanner: new DiskScanner(env.DEV_STORAGE_DIR), name: `disk signature scan (${env.DEV_STORAGE_DIR})` };
  if (env.ALLOW_UNSCANNED_DOCUMENTS === 'true' && env.NODE_ENV !== 'production') return { scanner: { async scan() { return 'clean'; } }, name: 'NO SCANNING (explicitly allowed for local use)' };
  return { scanner: unconfiguredScanner, name: 'NOT CONFIGURED — documents will stay unusable (scan_status=failed). Wire ClamAV (clamd INSTREAM) behind ScanPort.' };
}
