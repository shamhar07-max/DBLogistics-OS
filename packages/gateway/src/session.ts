import { EncryptJWT, jwtDecrypt } from 'jose';
import { createHash } from 'node:crypto';

export interface Session { accessToken: string; refreshToken?: string; accessExpiresAt: number; tenantId: string; user: { sub: string; email?: string }; workspace?: string; csrf: string }
export const COOKIE = 'dbl_session';
const key = (secret: string) => createHash('sha256').update(secret).digest();   // 32 bytes → AES-256-GCM

/** Sealed (encrypted + authenticated) session: tokens are readable only by the server; the cookie is HttpOnly. */
export async function seal(s: Session, secret: string, ttlSec = 8 * 3600): Promise<string> {
  return new EncryptJWT({ s }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime(`${ttlSec}s`).encrypt(key(secret));
}
export async function unseal(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null; try { return ((await jwtDecrypt(token, key(secret))).payload as any).s as Session; } catch { return null; }
}
export const readCookie = (req: Request, name: string) => req.headers.get('cookie')?.split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === name)?.slice(1).join('=');
export const setCookie = (name: string, value: string, o: { maxAge?: number; secure: boolean; path?: string }) =>
  `${name}=${value}; Path=${o.path ?? '/'}; HttpOnly; SameSite=Lax; ${o.secure ? 'Secure; ' : ''}Max-Age=${o.maxAge ?? 8 * 3600}`;
export const clearCookie = (name: string, secure: boolean) => setCookie(name, '', { maxAge: 0, secure });
