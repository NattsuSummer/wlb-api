// Password hashing and token helpers built on WebCrypto (works in Workers and Node ≥ 20).

const ITERATIONS = 100_000; // Cloudflare Workers caps PBKDF2 at 100k iterations.
const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Returns "pbkdf2$<iterations>$<salt b64>$<hash b64>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !saltB64 || !hashB64) return false;
  const expected = fromB64(hashB64);
  const actual = await pbkdf2(password, fromB64(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64url = toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return prefix + b64url;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Password rules shared with the frontend. Returns a list of failed rule codes. */
export function passwordProblems(pw: string, opts: { forbid?: string[] } = {}): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push('min_length_8');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) out.push('letters_and_digits');
  if (opts.forbid?.includes(pw)) out.push('not_default');
  return out;
}
