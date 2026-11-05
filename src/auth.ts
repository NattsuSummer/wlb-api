import type { D1Database } from './db';
import { randomToken, sha256Hex } from './crypto';
import { forbidden, unauthorized } from './http';
import type { Ctx } from './router';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  mustChangePassword: boolean;
  tokenId: string;
  tokenKind: 'session' | 'api';
}

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_SHORT = 1 * DAY;
export const SESSION_TTL_REMEMBER = 30 * DAY;

export async function createToken(
  db: D1Database,
  userId: number,
  kind: 'session' | 'api',
  opts: { ttlMs?: number; name?: string } = {},
): Promise<{ token: string; id: string; expiresAt: string | null }> {
  const token = randomToken(kind === 'api' ? 'wlb_' : 'wls_');
  const id = await sha256Hex(token);
  const expiresAt = opts.ttlMs ? new Date(Date.now() + opts.ttlMs).toISOString() : null;
  await db
    .prepare('INSERT INTO auth_tokens (id, user_id, kind, name, hint, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, kind, opts.name ?? null, token.slice(-4), expiresAt)
    .run();
  return { token, id, expiresAt };
}

interface TokenRow {
  token_id: string;
  kind: 'session' | 'api';
  expires_at: string | null;
  last_used_at: string | null;
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  must_change_password: number;
  disabled: number;
}

export async function authenticate(req: Request, db: D1Database): Promise<AuthUser | null> {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return null;
  const id = await sha256Hex(m[1]!);
  const row = await db
    .prepare(
      `SELECT t.id AS token_id, t.kind, t.expires_at, t.last_used_at,
              u.id, u.username, u.display_name, u.role, u.must_change_password, u.disabled
         FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.id = ?`,
    )
    .bind(id)
    .first<TokenRow>();
  if (!row || row.disabled) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    await db.prepare('DELETE FROM auth_tokens WHERE id = ?').bind(id).run();
    return null;
  }
  // Touch last_used_at at most once a minute to keep writes low.
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) {
    await db.prepare('UPDATE auth_tokens SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    tokenId: row.token_id,
    tokenKind: row.kind,
  };
}

export function requireUser(ctx: Ctx): AuthUser {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): AuthUser {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw forbidden('Admin only');
  return u;
}

/** Owner of the resource or an admin. */
export function requireSelfOrAdmin(ctx: Ctx, ownerId: number): AuthUser {
  const u = requireUser(ctx);
  if (u.id !== ownerId && u.role !== 'admin') throw forbidden('You can only change your own data');
  return u;
}
