import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { CONFIG, type Config } from './config';
import { DomainError } from './errors';
import { Db } from './db.service';

export interface Identity { sub: string; email?: string; name?: string }

@Injectable()
export class AuthService {
  private jwks?: JWTVerifyGetKey;
  constructor(@Inject(CONFIG) private cfg: Config, @Inject(Db) private db: Db) {
    if (cfg.OIDC_ISSUER_URL) this.jwks = createRemoteJWKSet(new URL(`${cfg.OIDC_ISSUER_URL.replace(/\/$/, '')}/protocol/openid-connect/certs`));
  }
  /** Verifies signature, issuer, audience and expiry. Application permissions are resolved separately from the database. */
  async verify(token: string): Promise<Identity> {
    try {
      const p = this.jwks
        ? (await jwtVerify(token, this.jwks, { issuer: this.cfg.OIDC_ISSUER_URL, audience: this.cfg.OIDC_AUDIENCE })).payload
        : (await jwtVerify(token, new TextEncoder().encode(this.requireDevSecret()), { audience: this.cfg.OIDC_AUDIENCE })).payload;
      if (!p.sub) throw new Error('no sub');
      return { sub: p.sub, email: p.email as string | undefined, name: p.name as string | undefined };
    } catch { throw new DomainError('UNAUTHENTICATED', 'Invalid or expired access token.'); }
  }
  private requireDevSecret() { if (!this.cfg.DEV_AUTH_SECRET) throw new Error('no auth configured'); return this.cfg.DEV_AUTH_SECRET; }
  /** Directory entry for the OIDC subject (created on first login). */
  async resolveUser(id: Identity): Promise<string> {
    return this.db.unscoped(async (c) => (await c.query(
      `INSERT INTO platform.users(subject, email, display_name) VALUES ($1,$2,$3)
       ON CONFLICT (subject) DO UPDATE SET email = COALESCE(EXCLUDED.email, platform.users.email) RETURNING id`, [id.sub, id.email ?? null, id.name ?? null])).rows[0].id);
  }
}
