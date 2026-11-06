import type { User, UserCredentials } from '../../domain/user';
import type { NewUser, UserPatch, UserRepository } from '../interfaces';
import type { D1Database } from './db';

interface Row {
  id: number;
  username: string;
  display_name: string;
  role: User['role'];
  locale: User['locale'];
  theme: User['theme'];
  avatar_color: string | null;
  must_change_password: number;
  disabled: number;
  last_login_at: string | null;
  created_at: string;
}

const COLS = 'id, username, display_name, role, locale, theme, avatar_color, must_change_password, disabled, last_login_at, created_at';
const CRED_COLS = 'id, password_hash, disabled, failed_logins, locked_until';

const toUser = (r: Row): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  locale: r.locale,
  theme: r.theme,
  avatarColor: r.avatar_color,
  mustChangePassword: !!r.must_change_password,
  disabled: !!r.disabled,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

interface CredRow { id: number; password_hash: string; disabled: number; failed_logins: number; locked_until: string | null }
const toCred = (r: CredRow): UserCredentials => ({ id: r.id, passwordHash: r.password_hash, disabled: !!r.disabled, failedLogins: r.failed_logins, lockedUntil: r.locked_until });

const PATCH_COLUMNS: Record<keyof UserPatch, string> = {
  displayName: 'display_name', role: 'role', locale: 'locale', theme: 'theme', avatarColor: 'avatar_color', disabled: 'disabled',
};

export class D1UserRepository implements UserRepository {
  constructor(private db: D1Database) {}

  async findById(id: number) {
    const r = await this.db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).bind(id).first<Row>();
    return r ? toUser(r) : null;
  }

  async findByUsername(username: string) {
    const r = await this.db.prepare(`SELECT ${COLS} FROM users WHERE username = ?`).bind(username).first<Row>();
    return r ? toUser(r) : null;
  }

  async credentialsByUsername(username: string) {
    const r = await this.db.prepare(`SELECT ${CRED_COLS} FROM users WHERE username = ?`).bind(username).first<CredRow>();
    return r ? toCred(r) : null;
  }

  async credentialsById(id: number) {
    const r = await this.db.prepare(`SELECT ${CRED_COLS} FROM users WHERE id = ?`).bind(id).first<CredRow>();
    return r ? toCred(r) : null;
  }

  async list(opts: { includeDisabled?: boolean } = {}) {
    const sql = `SELECT ${COLS} FROM users ${opts.includeDisabled ? '' : 'WHERE disabled = 0'} ORDER BY id`;
    return (await this.db.prepare(sql).all<Row>()).results.map(toUser);
  }

  async create(u: NewUser) {
    const res = await this.db
      .prepare('INSERT INTO users (username, display_name, password_hash, role, avatar_color, must_change_password) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(u.username, u.displayName, u.passwordHash, u.role, u.avatarColor ?? null, u.mustChangePassword ? 1 : 0)
      .run();
    return (await this.findById(Number(res.meta.last_row_id)))!;
  }

  async update(id: number, patch: UserPatch) {
    const keys = (Object.keys(patch) as (keyof UserPatch)[]).filter((k) => patch[k] !== undefined);
    if (!keys.length) return;
    const vals = keys.map((k) => (k === 'disabled' ? (patch.disabled ? 1 : 0) : patch[k]));
    await this.db.prepare(`UPDATE users SET ${keys.map((k) => `${PATCH_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`).bind(...vals, id).run();
  }

  async countActiveAdmins(exceptId?: number) {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
      .bind(exceptId ?? -1)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async recordFailedLogin(id: number, failedLogins: number, lockedUntil: string | null) {
    await this.db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').bind(failedLogins, lockedUntil, id).run();
  }

  async recordSuccessfulLogin(id: number, at: string) {
    await this.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').bind(at, id).run();
  }

  async setPassword(id: number, passwordHash: string, mustChange: boolean) {
    await this.db
      .prepare('UPDATE users SET password_hash = ?, must_change_password = ?, failed_logins = 0, locked_until = NULL WHERE id = ?')
      .bind(passwordHash, mustChange ? 1 : 0, id)
      .run();
  }
}
