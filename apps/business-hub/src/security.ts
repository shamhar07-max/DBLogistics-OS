const enc = new TextEncoder();
export const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : b)));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256 = async (s: string) => b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
/** Workers cap PBKDF2 at 100 000 iterations. */
export const ITERATIONS = 100_000;
export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16)), iter = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return { hash: b64(bits), salt: b64(salt), iter };
}
export const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export async function verifyPassword(password: string, rec: { pw_hash: string; pw_salt: string; pw_iter: number }) {
  return safeEqual((await hashPassword(password, unb64(rec.pw_salt), rec.pw_iter)).hash, rec.pw_hash);
}
const COMMON = new Set(['password', 'password1', 'password123', 'qwerty123', '12345678', '123456789', 'letmein123', 'welcome123', 'admin12345', 'iloveyou1']);
/** ≥10 characters, letters and a digit or symbol, not a well-known password, not the email. */
export function passwordIssue(pw: string, email = ''): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.'; if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[^A-Za-z]/.test(pw)) return 'Mix letters with at least one number or symbol.';
  if (COMMON.has(pw.toLowerCase()) || (email && pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length > 3)) return 'That password is too easy to guess.';
  return null;
}
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
