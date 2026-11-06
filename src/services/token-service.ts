// Issues and resolves bearer tokens. Only a SHA-256 hash of each token is stored.
import type { Actor } from '../domain/user';
import type { TokenRepository } from '../repositories/interfaces';
import type { Clock } from './clock';
import { toB64 } from './password-service';

const enc = new TextEncoder();
const DAY_MS = 24 * 60 * 60 * 1000;

export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class TokenService {
  constructor(private tokens: TokenRepository, private clock: Clock) {}

  /** Login session (expires) or personal API token (no expiry). The plain token is returned once. */
  async issue(userId: number, kind: 'session' | 'api', opts: { days?: number; name?: string } = {}) {
    const token = randomToken(kind === 'api' ? 'wlb_' : 'wls_');
    const id = await sha256Hex(token);
    const expiresAt = opts.days ? new Date(this.clock.now().getTime() + opts.days * DAY_MS).toISOString() : null;
    await this.tokens.create({ id, userId, kind, name: opts.name ?? null, hint: token.slice(-4), expiresAt });
    return { token, id, expiresAt };
  }

  /** Bearer token → acting user, or null. Touches last_used_at at most once a minute. */
  async resolve(token: string): Promise<Actor | null> {
    const id = await sha256Hex(token);
    const now = this.clock.now();
    const found = await this.tokens.findActor(id, now);
    if (!found) return null;
    const { lastUsedAt, ...actor } = found;
    if (!lastUsedAt || now.getTime() - Date.parse(lastUsedAt) > 60_000) await this.tokens.touch(id, now.toISOString());
    return actor;
  }
}
