import { requireAdmin, requireUser } from '../auth';
import { hashPassword } from '../crypto';
import { asEnum, asString, badRequest, conflict, json, notFound, readJson } from '../http';
import { maskSlot, visibility } from '../lib/privacy';
import { nowInfo, summarize } from '../lib/schedule';
import { bangkokNow } from '../lib/time';
import type { Router } from '../router';
import { getUser, listTimeCategories, listUsers, loadPrivacy, loadTargets, loadWeek, publicUser, type UserRow } from '../store';
import { tokenOut } from './me';
import type { D1Database } from '../db';

/** A member card as another member is allowed to see it (used by the members page and "now"). */
export async function memberCard(db: D1Database, u: UserRow, viewerId: number, categoryIds: number[], at = new Date()) {
  const isOwner = u.id === viewerId;
  const privacy = await loadPrivacy(db, u.id);
  const nowLevel = visibility(privacy, 'nowStatus', isOwner);
  const schedLevel = visibility(privacy, 'schedule', isOwner);
  const sumLevel = visibility(privacy, 'summary', isOwner);
  const needWeek = nowLevel !== 'hide' || sumLevel !== 'hide' || schedLevel !== 'hide';
  const week = needWeek ? await loadWeek(db, u.id) : null;

  let now = null;
  if (week && nowLevel !== 'hide') {
    const info = nowInfo(week, bangkokNow(at));
    now = {
      ...info,
      current: info.current ? { ...info.current, slot: maskSlot(info.current.slot, nowLevel) } : null,
      next: info.next ? { ...info.next, slot: maskSlot(info.next.slot, nowLevel) } : null,
    };
  }
  const summary = week && sumLevel !== 'hide' ? summarize(week, categoryIds, await loadTargets(db, u.id)) : null;
  return {
    user: publicUser(u),
    isMe: isOwner,
    privateMode: !isOwner && privacy.privateMode,
    visible: { schedule: schedLevel, now: nowLevel, summary: sumLevel, courses: visibility(privacy, 'courses', isOwner) },
    now,
    summary,
  };
}

export function userRoutes(r: Router) {
  // Members page
  r.get('/api/users', async (ctx) => {
    const me = requireUser(ctx);
    const cats = (await listTimeCategories(ctx.env.DB)).map((c) => c.id);
    const users = await listUsers(ctx.env.DB);
    const members = [];
    for (const u of users) members.push(await memberCard(ctx.env.DB, u, me.id, cats));
    return json({ members });
  });

  // ---------- admin ----------
  r.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const users = await listUsers(ctx.env.DB, true);
    return json({
      users: users.map((u) => ({
        ...publicUser(u),
        disabled: !!u.disabled,
        mustChangePassword: !!u.must_change_password,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
      })),
    });
  });

  r.post('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const b = await readJson(ctx.req);
    const username = asString(b.username, 'username', { min: 2, max: 32 }).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(username)) throw badRequest('username may only contain a–z, 0–9, _ . -');
    const displayName = asString(b.displayName ?? username, 'displayName', { min: 1, max: 40 });
    const password = asString(b.password, 'password', { min: 1, max: 200 });
    if (password.length < 8) throw badRequest('Temporary password must be at least 8 characters');
    const role = asEnum(b.role ?? 'member', 'role', ['admin', 'member'] as const);
    if (await ctx.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) throw conflict('username_taken', 'Username already exists');
    const res = await ctx.env.DB
      .prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .bind(username, displayName, await hashPassword(password), role)
      .run();
    const user = await getUser(ctx.env.DB, Number(res.meta.last_row_id));
    // New users start with an empty schedule and all targets at 0 (= not set).
    return json({ user: publicUser(user!) }, 201);
  });

  r.patch('/api/admin/users/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const target = await getUser(ctx.env.DB, id);
    if (!target) throw notFound('User not found');
    const b = await readJson(ctx.req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.displayName !== undefined) { sets.push('display_name = ?'); vals.push(asString(b.displayName, 'displayName', { min: 1, max: 40 })); }
    if (b.role !== undefined) {
      const role = asEnum(b.role, 'role', ['admin', 'member'] as const);
      if (role === 'member' && target.role === 'admin') await ensureAnotherAdmin(ctx.env.DB, id);
      sets.push('role = ?'); vals.push(role);
    }
    if (b.disabled !== undefined) {
      if (id === admin.id) throw badRequest('You cannot disable your own account');
      if (b.disabled === true && target.role === 'admin') await ensureAnotherAdmin(ctx.env.DB, id);
      sets.push('disabled = ?'); vals.push(b.disabled === true ? 1 : 0);
    }
    if (!sets.length) throw badRequest('Nothing to update');
    const stmts = [ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
    if (b.disabled === true) stmts.push(ctx.env.DB.prepare('DELETE FROM auth_tokens WHERE user_id = ?').bind(id));
    await ctx.env.DB.batch(stmts);
    return json({ user: publicUser((await getUser(ctx.env.DB, id))!) });
  });

  r.post('/api/admin/users/:id/reset-password', async (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    if (!(await getUser(ctx.env.DB, id))) throw notFound('User not found');
    const b = await readJson(ctx.req);
    const password = asString(b.password, 'password', { min: 8, max: 200 });
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(await hashPassword(password), id),
      ctx.env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND kind = 'session'").bind(id),
    ]);
    return json({ ok: true });
  });

  r.get('/api/admin/tokens', async (ctx) => {
    requireAdmin(ctx);
    const rows = await ctx.env.DB
      .prepare("SELECT t.id, t.name, t.hint, t.last_used_at, t.created_at, u.username FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.kind = 'api' ORDER BY t.created_at DESC")
      .all();
    return json({ tokens: rows.results.map(tokenOut) });
  });

  r.delete('/api/admin/tokens/:id', async (ctx) => {
    requireAdmin(ctx);
    const res = await ctx.env.DB.prepare("DELETE FROM auth_tokens WHERE id = ? AND kind = 'api'").bind(ctx.params.id).run();
    if (!res.meta.changes) throw notFound('Token not found');
    return json({ ok: true });
  });
}

async function ensureAnotherAdmin(db: D1Database, exceptId: number) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").bind(exceptId).first<{ n: number }>();
  if (!r || r.n < 1) throw conflict('last_admin', 'There must be at least one active admin');
}
