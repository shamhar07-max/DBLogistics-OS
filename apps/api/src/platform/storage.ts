import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CONFIG, type Config } from './config';

export interface StoragePort {
  presignUpload(key: string, contentType: string, expiresSec: number): Promise<string>;
  presignDownload(key: string, expiresSec: number): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
}
export const STORAGE = Symbol('STORAGE');

/** Private S3-compatible bucket. Downloads and uploads use short-lived signed URLs only. */
@Injectable()
export class S3Storage implements StoragePort {
  private s3: S3Client;
  constructor(@Inject(CONFIG) private cfg: Config) { this.s3 = new S3Client({ region: process.env.AWS_REGION ?? 'me-central-1', endpoint: cfg.S3_ENDPOINT, forcePathStyle: cfg.S3_FORCE_PATH_STYLE === undefined ? !!cfg.S3_ENDPOINT : cfg.S3_FORCE_PATH_STYLE === 'true' }); }
  presignUpload(key: string, contentType: string, expiresSec: number) { return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.cfg.DOCUMENT_BUCKET, Key: key, ContentType: contentType, ...(this.cfg.S3_SERVER_SIDE_ENCRYPTION === 'none' ? {} : { ServerSideEncryption: this.cfg.S3_SERVER_SIDE_ENCRYPTION }) }), { expiresIn: expiresSec }); }
  presignDownload(key: string, expiresSec: number) { return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.cfg.DOCUMENT_BUCKET, Key: key }), { expiresIn: expiresSec }); }
  async head(key: string) { try { const h = await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.DOCUMENT_BUCKET, Key: key })); return { size: h.ContentLength ?? 0 }; } catch { return null; } }
}
/** In-memory adapter for tests / local dev without object storage. */
export class MemoryStorage implements StoragePort {
  objects = new Map<string, number>();
  async presignUpload(key: string) { return `memory://upload/${key}`; }
  async presignDownload(key: string) { return `memory://download/${key}`; }
  async head(key: string) { const s = this.objects.get(key); return s ? { size: s } : null; }
}

/**
 * Local-disk object store for development without MinIO/S3: files live under DEV_STORAGE_DIR and are reachable through
 * signed, expiring URLs served by `mountDevFiles` (main.ts). Never selected in production (config refuses DEV_AUTH_SECRET there).
 */
export class DiskStorage implements StoragePort {
  constructor(private cfg: Config) {}
  private file(key: string) { return join(this.cfg.DEV_STORAGE_DIR, createHash('sha256').update(key).digest('hex')); }
  private sign(key: string, method: string, exp: number) { return createHmac('sha256', this.cfg.DEV_AUTH_SECRET ?? '').update(`${method}:${key}:${exp}`).digest('hex'); }
  private url(key: string, method: string, expiresSec: number) { const exp = Math.floor(Date.now() / 1000) + expiresSec; return `${this.cfg.PUBLIC_API_URL}/api/v1/dev-files/${encodeURIComponent(key)}?exp=${exp}&sig=${this.sign(key, method, exp)}`; }
  async presignUpload(key: string, _ct: string, expiresSec: number) { return this.url(key, 'PUT', expiresSec); }
  async presignDownload(key: string, expiresSec: number) { return this.url(key, 'GET', expiresSec); }
  verify(key: string, method: string, exp: number, sig: string) { const good = this.sign(key, method, exp); return exp > Date.now() / 1000 && sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good)); }
  async put(key: string, body: Buffer, contentType: string) { await mkdir(this.cfg.DEV_STORAGE_DIR, { recursive: true }); await writeFile(this.file(key), body); await writeFile(`${this.file(key)}.type`, contentType); }
  async get(key: string) { try { return { body: await readFile(this.file(key)), contentType: await readFile(`${this.file(key)}.type`, 'utf8').catch(() => 'application/octet-stream') }; } catch { return null; } }
  async head(key: string) { try { return { size: (await stat(this.file(key))).size }; } catch { return null; } }
}
