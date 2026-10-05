import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
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
/** Reads stored object bytes for scanning. */
export interface ObjectReader { read(storageKey: string): Promise<Buffer> }
export class DiskReader implements ObjectReader {
  constructor(private dir: string) {}
  read(key: string) { return readFile(diskPath(this.dir, key)); }
}
export class S3Reader implements ObjectReader {
  constructor(private bucket: string, private client?: { send(c: unknown): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }> }) {}
  async read(key: string) {
    const sdk = await import('@aws-sdk/client-s3');
    const c = this.client ?? new sdk.S3Client({ region: process.env.AWS_REGION ?? 'auto', endpoint: process.env.S3_ENDPOINT, forcePathStyle: !!process.env.S3_ENDPOINT });
    const r = await c.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

export type ClamdTarget = { host: string; port: number } | { path: string };
/** Thrown when clamd cannot be reached or answers with an error: the job must be retried, never marked clean. */
export class ScannerUnavailable extends Error {}

/** ClamAV (clamd) scanner over the INSTREAM protocol: the bytes are streamed to the daemon, so no shared filesystem is needed. */
export class ClamdScanner implements ScanPort {
  detail = new Map<string, string>();
  constructor(private reader: ObjectReader, private target: ClamdTarget, private timeoutMs = 60_000, private chunk = 64 * 1024) {}

  async ping(): Promise<boolean> { try { return (await this.command('zPING\0')).trim() === 'PONG'; } catch { return false; } }

  private command(cmd: string | Buffer[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock: Socket = 'path' in this.target ? connect(this.target.path) : connect(this.target.port, this.target.host);
      const out: Buffer[] = [];
      const fail = (e: Error) => { sock.destroy(); reject(new ScannerUnavailable(e.message)); };
      sock.setTimeout(this.timeoutMs, () => fail(new Error('clamd timeout')));
      sock.on('error', fail);
      sock.on('data', (d) => out.push(d));
      sock.on('end', () => resolve(Buffer.concat(out).toString().replace(/\0$/, '')));
      sock.on('connect', () => { for (const part of typeof cmd === 'string' ? [Buffer.from(cmd)] : cmd) sock.write(part); });
    });
  }

  async scan(storageKey: string): Promise<'clean' | 'infected' | 'failed'> {
    let bytes: Buffer;
    try { bytes = await this.reader.read(storageKey); } catch { return 'failed'; }
    const parts: Buffer[] = [Buffer.from('zINSTREAM\0')];
    for (let o = 0; o < bytes.length; o += this.chunk) {
      const c = bytes.subarray(o, o + this.chunk);
      const len = Buffer.alloc(4); len.writeUInt32BE(c.length);
      parts.push(len, c);
    }
    parts.push(Buffer.alloc(4));
    const reply = (await this.command(parts)).trim();
    if (/ OK$/.test(reply)) return 'clean';
    const m = / (.+) FOUND$/.exec(reply);
    if (m) { this.detail.set(storageKey, m[1]!); return 'infected'; }
    throw new ScannerUnavailable(`clamd: ${reply || 'empty reply'}`);
  }
}

/** Fail closed: with no scanner configured, nothing is ever marked clean. */
export const unconfiguredScanner: ScanPort = { async scan() { return 'failed'; } };

export function pickReader(env: Record<string, string | undefined> = process.env): ObjectReader | undefined {
  return env.DEV_STORAGE_DIR ? new DiskReader(env.DEV_STORAGE_DIR) : env.DOCUMENT_BUCKET ? new S3Reader(env.DOCUMENT_BUCKET) : undefined;
}
export function pickScanner(env: Record<string, string | undefined> = process.env): { scanner: ScanPort; name: string } {
  if (env.CLAMD_HOST || env.CLAMD_SOCKET) {
    const target: ClamdTarget = env.CLAMD_SOCKET ? { path: env.CLAMD_SOCKET } : { host: env.CLAMD_HOST!, port: Number(env.CLAMD_PORT ?? 3310) };
    const reader = pickReader(env);
    if (reader) return { scanner: new ClamdScanner(reader, target), name: `ClamAV clamd ${'path' in target ? target.path : `${target.host}:${target.port}`}` };
  }
  if (env.DEV_STORAGE_DIR) return { scanner: new DiskScanner(env.DEV_STORAGE_DIR), name: `disk signature scan (${env.DEV_STORAGE_DIR})` };
  if (env.ALLOW_UNSCANNED_DOCUMENTS === 'true' && env.NODE_ENV !== 'production') return { scanner: { async scan() { return 'clean'; } }, name: 'NO SCANNING (explicitly allowed for local use)' };
  return { scanner: unconfiguredScanner, name: 'NOT CONFIGURED — documents will stay unusable (scan_status=failed). Set CLAMD_HOST/CLAMD_PORT (or CLAMD_SOCKET) plus DOCUMENT_BUCKET.' };
}
