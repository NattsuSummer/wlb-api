import { createToken, requireUser, SESSION_TTL_REMEMBER, SESSION_TTL_SHORT } from '../auth';
import { hashPassword, passwordProblems, verifyPassword } from '../crypto';
import { asString, badRequest, HttpError, json, readJson } from '../http';
import type { Router } from '../router';
import { getUser, selfUser } from '../store';

const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000;
// Used to spend the same time on unknown usernames as on wrong passwords.
let dummyHash: Promise<string> | null = null;

export function authRoutes(r: Router) {
  r.post('/api/auth/login', async ({ req, env }) => {
    const body = await readJson(req);
    const username = asString(body.username, 'username', { min: 1, max: 64 });
    const password = asString(body.password, 'password', { min: 1, max: 200 });
    const remember = body.remember === true;

    const row = await env.DB
      .prepare('SELECT id, password_hash, disabled, failed_logins, locked_until FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: number; password_hash: string; disabled: number; failed_logins: number; locked_until: string | null }>();

    if (row?.locked_until && Date.parse(row.locked_until) > Date.now()) {
      throw new HttpError(429, 'locked', 'Too many failed attempts. Try again in a few minutes.');
    }
    const ok = row ? await verifyPassword(password, row.password_hash) : await verifyPassword(password, await (dummyHash ??= hashPassword('dummy-password-1')));
    if (!row || !ok || row.disabled) {
      if (row && !ok) {
        const fails = row.failed_logins + 1;
        await env.DB
          .prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
          .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null, row.id)
          .run();
      }
      throw new HttpError(401, 'invalid_credentials', 'Username or password is incorrect');
    }

    await env.DB
      .prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.id)
      .run();
    const session = await createToken(env.DB, row.id, 'session', { ttlMs: remember ? SESSION_TTL_REMEMBER : SESSION_TTL_SHORT });
    const user = await getUser(env.DB, row.id);
    return json({ token: session.token, expiresAt: session.expiresAt, user: selfUser(user!) });
  });

  r.post('/api/auth/logout', async (ctx) => {
    const u = requireUser(ctx);
    await ctx.env.DB.prepare('DELETE FROM auth_tokens WHERE id = ?').bind(u.tokenId).run();
    return json({ ok: true });
  });

  // Change own password. Also used for the forced change after the first login.
  r.post('/api/me/password', async (ctx) => {
    const u = requireUser(ctx);
    const body = await readJson(ctx.req);
    const current = asString(body.currentPassword, 'currentPassword', { min: 1, max: 200 });
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    const row = await ctx.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(current, row.password_hash))) throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect');
    const problems = passwordProblems(next, { forbid: [current] });
    if (problems.length) throw badRequest('New password does not meet the rules', { problems });
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(await hashPassword(next), u.id),
      // Sign out other devices; keep this session.
      ctx.env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND kind = 'session' AND id != ?").bind(u.id, u.tokenId),
    ]);
    return json({ ok: true });
  });
}
