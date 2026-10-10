import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/platform/config';
import { S3Storage } from '../apps/api/src/platform/storage';

process.env.AWS_ACCESS_KEY_ID = 'unit-test-access';
process.env.AWS_SECRET_ACCESS_KEY = 'unit-test-secret';
process.env.AWS_REGION = 'eu-west-1';

test('Supabase-compatible signing omits AWS KMS and uses a bucket path', async () => {
  const storage = new S3Storage(loadConfig({ DOCUMENT_BUCKET: 'private-documents', S3_ENDPOINT: 'https://storage.example.com/storage/v1/s3', S3_FORCE_PATH_STYLE: 'true', S3_SERVER_SIDE_ENCRYPTION: 'none' }));
  const url = new URL(await storage.presignUpload('tenant/incoming/test', 'application/pdf', 60));
  assert.equal(url.host, 'storage.example.com');
  assert.equal(url.pathname, '/storage/v1/s3/private-documents/tenant/incoming/test');
  assert.equal(url.searchParams.has('x-amz-server-side-encryption'), false);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
});
test('AWS default encryption is preserved and virtual-host addressing is selectable', async () => {
  assert.equal(loadConfig({}).S3_SERVER_SIDE_ENCRYPTION, 'aws:kms');
  const storage = new S3Storage(loadConfig({ DOCUMENT_BUCKET: 'private-documents', S3_ENDPOINT: 'https://storage.example.com', S3_FORCE_PATH_STYLE: 'false', S3_SERVER_SIDE_ENCRYPTION: 'AES256' }));
  const url = new URL(await storage.presignDownload('tenant/file', 60));
  assert.equal(url.host, 'private-documents.storage.example.com');
  assert.equal(url.pathname, '/tenant/file');
  assert.throws(() => loadConfig({ S3_SERVER_SIDE_ENCRYPTION: 'invalid' }));
});
