import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ROUTES, ApiErrorSchema } from '../src';

extendZodWithOpenApi(z);
const reg = new OpenAPIRegistry();
reg.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
const Err = reg.register('ApiError', ApiErrorSchema);
for (const r of ROUTES) {
  const path = '/api/v1' + r.path.replace(/:(\w+)/g, '{$1}');
  const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
  const headers: Record<string, z.ZodTypeAny> = { 'X-Tenant-Id': z.string().uuid() };
  if (r.idempotent) headers['Idempotency-Key'] = z.string().min(8);
  if (r.ifMatch) headers['If-Match'] = z.string();
  reg.registerPath({
    method: r.method.toLowerCase() as 'get' | 'post', path, operationId: r.operationId, tags: [r.tag], summary: r.summary,
    description: `Permission: ${r.permission ?? (r.public ? 'public (signature verified)' : 'authenticated')}`,
    security: r.public ? [] : [{ bearer: [] }],
    request: {
      query: r.query as never,
      params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string().uuid().or(z.string())]))) : undefined,
      headers: r.public ? undefined : z.object(headers).partial({ 'X-Tenant-Id': r.path.startsWith('/me') ? true : undefined } as never),
      body: r.body ? { content: { 'application/json': { schema: r.body } } } : undefined,
    },
    responses: {
      [String(r.status ?? 200)]: { description: 'OK' },
      '4XX': { description: 'Error', content: { 'application/json': { schema: Err } } },
    },
  });
}
const doc = new OpenApiGeneratorV3(reg.definitions).generateDocument({
  openapi: '3.0.3', info: { title: 'DigitalBurj Logistics OS API', version: '1.0.0', description: 'Versioned REST contract. Money = decimal strings. Commands are idempotent via Idempotency-Key; mutable aggregates use If-Match.' },
  servers: [{ url: '/' }],
});
mkdirSync(new URL('../../../specifications/architecture/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../../specifications/architecture/openapi.json', import.meta.url), JSON.stringify(doc, null, 2));
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths, ${ROUTES.length} operations`);
