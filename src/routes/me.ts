import { createToken, requireUser } from '../auth';
import { asEnum, asString, badRequest, json, notFound, readJson } from '../http';
import type { Privacy } from '../lib/privacy';
import type { Router } from '../router';
import { getUser, loadPrivacy, savePrivacy, selfUser } from '../store';

export function meRoutes(r: Router) {
  r.get('/api/me', async (ctx) => {
    const u = requireUser(ctx);
    const row = await getUser(ctx.env.DB, u.id);
    if (!row) throw notFound();
    return json({ user: selfUser(row), privacy: await loadPrivacy(ctx.env.DB, u.id) });
  });

  r.patch('/api/me', async (ctx) => {
    const u = requireUser(ctx);
    const body = await readJson(ctx.req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body.displayName !== undefined) { sets.push('display_name = ?'); vals.push(asString(body.displayName, 'displayName', { min: 1, max: 40 })); }
    if (body.locale !== undefined) { sets.push('locale = ?'); vals.push(asEnum(body.locale, 'locale', ['th', 'en'] as const)); }
    if (body.theme !== undefined) { sets.push('theme = ?'); vals.push(asEnum(body.theme, 'theme', ['dark', 'light', 'system'] as const)); }
    if (body.avatarColor !== undefined) {
      const c = asString(body.avatarColor, 'avatarColor');
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw badRequest('avatarColor must be #RRGGBB');
      sets.push('avatar_color = ?'); vals.push(c);
    }
    if (!sets.length) throw badRequest('Nothing to update');
    await ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run();
    return json({ user: selfUser((await getUser(ctx.env.DB, u.id))!) });
  });

  r.get('/api/me/privacy', async (ctx) => json({ privacy: await loadPrivacy(ctx.env.DB, requireUser(ctx).id) }));

  r.put('/api/me/privacy', async (ctx) => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req);
    const p: Privacy = {
      privateMode: b.privateMode === true,
      schedule: asEnum(b.schedule, 'schedule', ['full', 'cat', 'hide'] as const),
      nowStatus: asEnum(b.nowStatus, 'nowStatus', ['full', 'cat', 'hide'] as const),
      summary: asEnum(b.summary, 'summary', ['show', 'hide'] as const),
      courses: asEnum(b.courses, 'courses', ['show', 'hide'] as const),
      answers: asEnum(b.answers, 'answers', ['show', 'hide'] as const),
    };
    await savePrivacy(ctx.env.DB, u.id, p);
    return json({ privacy: p });
  });

  // ---------- personal API tokens (for scripts / MCP clients without OAuth) ----------
  r.get('/api/me/tokens', async (ctx) => {
    const u = requireUser(ctx);
    const rows = await ctx.env.DB
      .prepare("SELECT id, name, hint, last_used_at, created_at FROM auth_tokens WHERE user_id = ? AND kind = 'api' ORDER BY created_at DESC")
      .bind(u.id)
      .all();
    return json({ tokens: rows.results.map(tokenOut) });
  });

  r.post('/api/me/tokens', async (ctx) => {
    const u = requireUser(ctx);
    if (u.tokenKind !== 'session') throw badRequest('Create API tokens from a logged-in session');
    const body = await readJson(ctx.req);
    const name = asString(body.name, 'name', { min: 1, max: 60 });
    const t = await createToken(ctx.env.DB, u.id, 'api', { name });
    // The plain token is returned exactly once.
    return json({ token: t.token, id: t.id, name }, 201);
  });

  r.delete('/api/me/tokens/:id', async (ctx) => {
    const u = requireUser(ctx);
    const res = await ctx.env.DB.prepare("DELETE FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'api'").bind(ctx.params.id, u.id).run();
    if (!res.meta.changes) throw notFound('Token not found');
    return json({ ok: true });
  });
}

export const tokenOut = (r: Record<string, unknown>) => ({
  id: r.id,
  name: r.name,
  hint: r.hint,
  lastUsedAt: r.last_used_at ?? null,
  createdAt: r.created_at,
  ...(r.username !== undefined ? { owner: r.username } : {}),
});
