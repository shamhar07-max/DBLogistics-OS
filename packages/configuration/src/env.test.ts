import { describe, expect, it } from 'vitest';
import { loadGatewayEnv } from './index';
describe('gateway env', () => {
  it('accepts dev config, rejects dev auth in production', () => {
    expect(loadGatewayEnv({ SESSION_SECRET: 'x'.repeat(40), DEV_AUTH_SECRET: 'dev' }).API_BASE_URL).toBe('http://localhost:3001');
    expect(() => loadGatewayEnv({ SESSION_SECRET: 'x'.repeat(40), DEV_AUTH_SECRET: 'dev', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => loadGatewayEnv({ SESSION_SECRET: 'short' })).toThrow();
  });
});
