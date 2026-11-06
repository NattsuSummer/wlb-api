import type { OAuthClient } from '../../domain/oauth';
import type { OAuthCode, OAuthGrant, OAuthRepository } from '../interfaces';
import type { D1Database } from './db';

type Row = Record<string, unknown>;

const toCode = (r: Row): OAuthCode => ({
  codeHash: String(r.code_hash), clientId: String(r.client_id), userId: Number(r.user_id), redirectUri: String(r.redirect_uri),
  codeChallenge: String(r.code_challenge), scope: String(r.scope), autoPublish: !!r.auto_publish, expiresAt: String(r.expires_at),
});

const toGrant = (r: Row): OAuthGrant => ({
  id: Number(r.id), clientId: String(r.client_id), userId: Number(r.user_id), refreshHash: String(r.refresh_hash),
  accessTokenId: (r.access_token_id as string) ?? null, scope: String(r.scope), autoPublish: !!r.auto_publish, refreshExpiresAt: String(r.refresh_expires_at),
});

export class D1OAuthRepository implements OAuthRepository {
  constructor(private db: D1Database) {}

  async createClient(c: Omit<OAuthClient, 'createdAt'>) {
    await this.db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris_json) VALUES (?, ?, ?)').bind(c.id, c.name, JSON.stringify(c.redirectUris)).run();
  }

  async findClient(id: string) {
    const r = await this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(id).first<Row>();
    if (!r) return null;
    let uris: string[] = [];
    try { uris = JSON.parse(String(r.redirect_uris_json)); } catch { /* corrupt row: no redirects */ }
    return { id: String(r.id), name: String(r.name), redirectUris: uris, createdAt: String(r.created_at) };
  }

  async saveCode(c: OAuthCode) {
    await this.db
      .prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, auto_publish, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.codeHash, c.clientId, c.userId, c.redirectUri, c.codeChallenge, c.scope, Number(c.autoPublish), c.expiresAt)
      .run();
  }

  async takeCode(codeHash: string) {
    const r = await this.db.prepare('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *').bind(codeHash).first<Row>();
    return r ? toCode(r) : null;
  }

  async createGrant(g: Omit<OAuthGrant, 'id'>) {
    const res = await this.db
      .prepare('INSERT INTO oauth_grants (client_id, user_id, refresh_hash, access_token_id, scope, auto_publish, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(g.clientId, g.userId, g.refreshHash, g.accessTokenId, g.scope, Number(g.autoPublish), g.refreshExpiresAt)
      .run();
    return Number(res.meta.last_row_id);
  }

  async findGrantByRefresh(refreshHash: string) {
    const r = await this.db.prepare('SELECT * FROM oauth_grants WHERE refresh_hash = ?').bind(refreshHash).first<Row>();
    return r ? toGrant(r) : null;
  }

  async findGrantByAccessToken(tokenId: string) {
    const r = await this.db
      .prepare('SELECT g.*, c.name AS client_name FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id WHERE g.access_token_id = ?')
      .bind(tokenId)
      .first<Row>();
    return r ? { ...toGrant(r), clientName: String(r.client_name) } : null;
  }

  async rotateGrant(id: number, refreshHash: string, accessTokenId: string, refreshExpiresAt: string) {
    const old = await this.db.prepare('SELECT access_token_id FROM oauth_grants WHERE id = ?').bind(id).first<{ access_token_id: string | null }>();
    const stmts = [
      this.db.prepare('UPDATE oauth_grants SET refresh_hash = ?, access_token_id = ?, refresh_expires_at = ? WHERE id = ?').bind(refreshHash, accessTokenId, refreshExpiresAt, id),
    ];
    if (old?.access_token_id) stmts.push(this.db.prepare('DELETE FROM auth_tokens WHERE id = ?').bind(old.access_token_id));
    await this.db.batch(stmts);
  }
}
