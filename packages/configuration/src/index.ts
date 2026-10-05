import { z } from 'zod';
/** PUBLIC (browser-visible) config: URLs and public client ids only. Secrets never use the NEXT_PUBLIC_ prefix. */
export const PublicEnv = z.object({ NEXT_PUBLIC_APP_NAME: z.string().default('DigitalBurj Logistics OS'), NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'ar']).default('en') });
/** SERVER-ONLY config for the session gateway (BFF). */
export const GatewayEnv = z.object({
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  SESSION_SECRET: z.string().min(32),
  OIDC_ISSUER_URL: z.string().url().optional(), OIDC_WEB_CLIENT_ID: z.string().optional(), OIDC_WEB_CLIENT_SECRET: z.string().optional(), OIDC_REDIRECT_URI: z.string().url().optional(),
  DEV_AUTH_SECRET: z.string().optional(), NODE_ENV: z.string().default('development'),
}).refine((e) => e.NODE_ENV !== 'production' || (e.OIDC_ISSUER_URL && e.OIDC_WEB_CLIENT_ID && e.OIDC_WEB_CLIENT_SECRET && !e.DEV_AUTH_SECRET), { message: 'production requires OIDC and forbids DEV_AUTH_SECRET' });
export const loadGatewayEnv = (env: Record<string, string | undefined> = process.env) => GatewayEnv.parse(env);
