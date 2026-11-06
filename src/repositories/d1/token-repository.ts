import type { ApiTokenInfo } from '../../domain/category';
import type { NewToken, TokenRepository } from '../interfaces';
import type { D1Database } from './db';

interface ActorRow {
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

const toInfo = (r: Record<string, unknown>): ApiTokenInfo => ({
  id: String(r.id),
  name: (r.name as string | null) ?? null,
  hint: (r.hint as string | null) ?? null,
  lastUsedAt: (r.last_used_at as string | null) ?? null,
  createdAt: String(r.created_at),
  ...(r.username !== undefined ? { owner: String(r.username) } : {}),
});

export class D1TokenRepository implements TokenRepository {
  constructor(private db: D1Database) {}

  async create(t: NewToken) {
    await this.db
      .prepare('INSERT INTO auth_tokens (id, user_id, kind, name, hint, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(t.id, t.userId, t.kind, t.name, t.hint, t.expiresAt)
      .run();
  }

  async findActor(tokenId: string, now: Date) {
    const row = await this.db
      .prepare(
        `SELECT t.id AS token_id, t.kind, t.expires_at, t.last_used_at,
                u.id, u.username, u.display_name, u.role, u.must_change_password, u.disabled
           FROM auth_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.id = ?`,
      )
      .bind(tokenId)
      .first<ActorRow>();
    if (!row || row.disabled) return null;
    if (row.expires_at && Date.parse(row.expires_at) < now.getTime()) {
      await this.delete(tokenId);
      return null;
    }
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      mustChangePassword: !!row.must_change_password,
      tokenId: row.token_id,
      tokenKind: row.kind,
      lastUsedAt: row.last_used_at,
    };
  }

  async touch(tokenId: string, at: string) {
    await this.db.prepare('UPDATE auth_tokens SET last_used_at = ? WHERE id = ?').bind(at, tokenId).run();
  }

  async delete(tokenId: string) {
    await this.db.prepare('DELETE FROM auth_tokens WHERE id = ?').bind(tokenId).run();
  }

  async deleteForUser(userId: number, opts: { kind?: 'session' | 'api'; exceptId?: string } = {}) {
    let sql = 'DELETE FROM auth_tokens WHERE user_id = ?';
    const vals: unknown[] = [userId];
    if (opts.kind) { sql += ' AND kind = ?'; vals.push(opts.kind); }
    if (opts.exceptId) { sql += ' AND id != ?'; vals.push(opts.exceptId); }
    await this.db.prepare(sql).bind(...vals).run();
  }

  async listApiTokens(userId?: number) {
    const rows = userId === undefined
      ? await this.db
          .prepare("SELECT t.id, t.name, t.hint, t.last_used_at, t.created_at, u.username FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.kind = 'api' ORDER BY t.created_at DESC")
          .all()
      : await this.db
          .prepare("SELECT id, name, hint, last_used_at, created_at FROM auth_tokens WHERE user_id = ? AND kind = 'api' ORDER BY created_at DESC")
          .bind(userId)
          .all();
    return rows.results.map(toInfo);
  }

  async deleteApiToken(tokenId: string, userId?: number) {
    const res = userId === undefined
      ? await this.db.prepare("DELETE FROM auth_tokens WHERE id = ? AND kind = 'api'").bind(tokenId).run()
      : await this.db.prepare("DELETE FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'api'").bind(tokenId, userId).run();
    return !!res.meta.changes;
  }
}
