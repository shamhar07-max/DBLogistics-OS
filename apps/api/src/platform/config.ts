import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://dbl_app:dbl_app_dev@localhost:54329/dbl'),
  OIDC_ISSUER_URL: z.string().optional(),
  OIDC_AUDIENCE: z.string().default('dbl-api'),
  DEV_AUTH_SECRET: z.string().optional(),            // dev/test only: HS256 tokens. Refused when NODE_ENV=production.
  DOCUMENT_BUCKET: z.string().default('dbl-documents-dev'),
  S3_ENDPOINT: z.string().optional(),
  AI_DAILY_BUDGET_MICROS: z.coerce.number().default(5_000_000),
});
export type Config = z.infer<typeof Env>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const c = Env.parse(env);
  if (c.NODE_ENV === 'production' && (c.DEV_AUTH_SECRET || !c.OIDC_ISSUER_URL)) throw new Error('Production requires OIDC_ISSUER_URL and forbids DEV_AUTH_SECRET');
  return c;
};
export const CONFIG = Symbol('CONFIG');
