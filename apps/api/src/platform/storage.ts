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
  constructor(@Inject(CONFIG) private cfg: Config) { this.s3 = new S3Client({ region: process.env.AWS_REGION ?? 'me-central-1', endpoint: cfg.S3_ENDPOINT, forcePathStyle: !!cfg.S3_ENDPOINT }); }
  presignUpload(key: string, contentType: string, expiresSec: number) { return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.cfg.DOCUMENT_BUCKET, Key: key, ContentType: contentType, ServerSideEncryption: 'aws:kms' }), { expiresIn: expiresSec }); }
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
