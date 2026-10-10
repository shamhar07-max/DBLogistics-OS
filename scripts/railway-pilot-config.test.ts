import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/platform/config';
import { DocumentsService } from '../apps/api/src/documents/documents.module';

test('pilot parsing does not turn the string false into true', () => {
  assert.equal(loadConfig({ RAILWAY_FREE_PILOT: 'false' }).RAILWAY_FREE_PILOT, false);
  assert.equal(loadConfig({ RAILWAY_FREE_PILOT: 'true' }).RAILWAY_FREE_PILOT, true);
  assert.throws(() => loadConfig({ DB_POOL_MAX: '0' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', RAILWAY_FREE_PILOT: 'true', DEV_AUTH_SECRET: 'unsafe' }));
});
test('pilot refuses new and previously issued uploads before touching storage or database', () => {
  const service = new DocumentsService(
    { run: () => { throw new Error('database must not be called'); } } as any,
    { head: () => { throw new Error('storage must not be called'); } } as any,
    loadConfig({ RAILWAY_FREE_PILOT: 'true' }),
  );
  for (const operation of ['createUploadIntent', 'register'] as const) {
    assert.throws(() => service[operation]({} as any, {}), (error: any) => error.code === 'SERVICE_UNAVAILABLE');
  }
});
