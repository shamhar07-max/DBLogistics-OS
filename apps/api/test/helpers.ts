import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pg from 'pg';
import { randomUUID, createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module';
import { CONFIG, STORAGE, MemoryStorage, loadConfig } from '../src/platform';
import { addMemberToTenant, provisionTenant, type Provisioned } from '../src/provisioning';

export const APP_URL = 'postgres://dbl_app:dbl_app_dev@localhost:54329/dbl_test';
export const SU_URL = 'postgres://postgres@localhost:54329/dbl_test';       // superuser: bypasses RLS — used ONLY to verify / tamper from outside the app
export const SECRET = 'test-secret-0123456789-0123456789-xx';
export const storage = new MemoryStorage();

export async function bootApp() {
  process.env.DEV_AUTH_SECRET = SECRET; process.env.DATABASE_URL = APP_URL; process.env.SECRET_WH_STRIPE = 'whsec_test';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CONFIG).useValue(loadConfig()).overrideProvider(STORAGE).useValue(storage).compile();
  const app = mod.createNestApplication({ rawBody: true }); app.setGlobalPrefix('api/v1'); await app.init();
  return app;
}
export const token = (sub: string) => new SignJWT({ email: `${sub}@example.test` }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('dbl-api').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
export const su = () => new pg.Pool({ connectionString: SU_URL, max: 3 });

export class Client {
  constructor(private app: INestApplication, public sub: string, public tenantId: string) {}
  private async req(method: 'get' | 'post', path: string, body?: unknown, headers: Record<string, string> = {}) {
    const t = await token(this.sub); const r = (request(this.app.getHttpServer()) as any)[method](`/api/v1${path}`).set('Authorization', `Bearer ${t}`).set('X-Tenant-Id', this.tenantId);
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return body === undefined ? r : r.send(body);
  }
  get = (p: string, h?: Record<string, string>) => this.req('get', p, undefined, h);
  post = (p: string, b: unknown = {}, h?: Record<string, string>) => this.req('post', p, b, h);
  /** command with Idempotency-Key */
  cmd = (p: string, b: unknown = {}, key = randomUUID(), extra: Record<string, string> = {}) => this.req('post', p, b, { 'Idempotency-Key': key, ...extra });
}
export interface World { app: INestApplication; a: Provisioned; b: Provisioned; appPool: pg.Pool; su: pg.Pool; owner: Client; as: (sub: string, tenantId?: string) => Client; member: (tenantId: string, sub: string, roles: string[], extra?: { workspace?: string; partyId?: string }) => Promise<Client> }

export async function world(): Promise<World> {
  const app = await bootApp(); const appPool = new pg.Pool({ connectionString: APP_URL, max: 4 });
  const tag = randomUUID().slice(0, 6);
  const a = await provisionTenant(appPool, { slug: `acme-${tag}`, name: 'Acme Freight LLC', ownerSubject: `owner-a-${tag}` });
  const b = await provisionTenant(appPool, { slug: `bolt-${tag}`, name: 'Bolt Logistics FZE', ownerSubject: `owner-b-${tag}` });
  const w: World = {
    app, a, b, appPool, su: su(), owner: new Client(app, `owner-a-${tag}`, a.tenantId),
    as: (sub, tenantId = a.tenantId) => new Client(app, sub, tenantId),
    member: async (tenantId, sub, roles, extra = {}) => { await addMemberToTenant(appPool, tenantId, { subject: `${sub}-${tag}`, roles, ...extra }); return new Client(app, `${sub}-${tag}`, tenantId); },
  };
  return w;
}
export async function close(w: World) { await w.app.close(); await w.appPool.end(); await w.su.end(); }
export const sign = (secret: string, body: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

/** Creates parties for a tenant via the API. */
export async function makeParty(c: Client, name: string, roles: string[]) { const r = await c.post('/parties', { legalName: name, roles }); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); return r.body.id as string; }
export async function cleanDoc(w: World, docId: string) { await w.su.query(`UPDATE platform.document_versions SET scan_status='clean' WHERE document_id=$1`, [docId]); }

/** Uploads + registers + scans + approves a document (worker scan simulated by the superuser connection). */
export async function approvedDocument(w: World, c: Client, opts: { docType: string; issuerKind: string; relatedType: string; relatedId: string }) {
  const intent = await c.post('/files/upload-intents', { contentType: 'application/pdf', sizeBytes: 1234 });
  const key = (await w.su.query(`SELECT storage_key FROM platform.upload_intents WHERE id=$1`, [intent.body.intentId])).rows[0].storage_key; storage.objects.set(key, 1234);
  const reg = await c.post('/documents', { intentId: intent.body.intentId, ...opts, sha256: 'a'.repeat(64) });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  await cleanDoc(w, reg.body.id);
  const ap = await c.post(`/documents/${reg.body.id}/approve`); if (ap.status !== 200) throw new Error(JSON.stringify(ap.body));
  return reg.body.id as string;
}
