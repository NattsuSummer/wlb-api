import { requireAdmin, requireUser } from '../auth';
import { asInt, asString, badRequest, conflict, json, notFound, readJson } from '../http';
import type { Router } from '../router';
import { categoryOut, listTimeCategories } from '../store';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function categoryRoutes(r: Router) {
  r.get('/api/time-categories', async (ctx) => {
    requireUser(ctx);
    const cats = await listTimeCategories(ctx.env.DB);
    const usage = await ctx.env.DB
      .prepare('SELECT category_id, COUNT(*) AS n FROM schedule_slot_categories GROUP BY category_id')
      .all<{ category_id: number; n: number }>();
    const used = new Map(usage.results.map((u) => [u.category_id, u.n]));
    return json({ categories: cats.map((c) => ({ ...categoryOut(c), usedSlots: used.get(c.id) ?? 0 })) });
  });

  r.post('/api/time-categories', async (ctx) => {
    requireAdmin(ctx);
    const b = await readJson(ctx.req);
    const nameTh = asString(b.nameTh, 'nameTh', { min: 1, max: 40 });
    const nameEn = asString(b.nameEn ?? nameTh, 'nameEn', { min: 1, max: 40 });
    const color = asString(b.color, 'color');
    if (!HEX.test(color)) throw badRequest('color must be #RRGGBB');
    const max = await ctx.env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM time_categories').first<{ m: number }>();
    const res = await ctx.env.DB
      .prepare('INSERT INTO time_categories (name_th, name_en, color, sort) VALUES (?, ?, ?, ?)')
      .bind(nameTh, nameEn, color.toUpperCase(), (max?.m ?? 0) + 1)
      .run();
    return json({ id: Number(res.meta.last_row_id) }, 201);
  });

  r.patch('/api/time-categories/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const b = await readJson(ctx.req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.nameTh !== undefined) { sets.push('name_th = ?'); vals.push(asString(b.nameTh, 'nameTh', { min: 1, max: 40 })); }
    if (b.nameEn !== undefined) { sets.push('name_en = ?'); vals.push(asString(b.nameEn, 'nameEn', { min: 1, max: 40 })); }
    if (b.color !== undefined) {
      const c = asString(b.color, 'color');
      if (!HEX.test(c)) throw badRequest('color must be #RRGGBB');
      sets.push('color = ?'); vals.push(c.toUpperCase());
    }
    if (b.sort !== undefined) { sets.push('sort = ?'); vals.push(asInt(b.sort, 'sort', 0, 1000)); }
    if (!sets.length) throw badRequest('Nothing to update');
    const res = await ctx.env.DB.prepare(`UPDATE time_categories SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    if (!res.meta.changes) throw notFound('Category not found');
    return json({ ok: true });
  });

  r.delete('/api/time-categories/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const used = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM schedule_slot_categories WHERE category_id = ?').bind(id).first<{ n: number }>();
    if (used && used.n > 0) throw conflict('category_in_use', `Category is used by ${used.n} slot(s). Move them to another category first.`, { usedSlots: used.n });
    const res = await ctx.env.DB.prepare('DELETE FROM time_categories WHERE id = ?').bind(id).run();
    if (!res.meta.changes) throw notFound('Category not found');
    return json({ ok: true });
  });

  r.get('/api/course-categories', async (ctx) => {
    requireUser(ctx);
    const rows = await ctx.env.DB.prepare('SELECT id, name_th, name_en, icon, tint, sort FROM course_categories ORDER BY sort, id').all<Record<string, unknown>>();
    return json({
      categories: rows.results.map((c) => ({ id: c.id, nameTh: c.name_th, nameEn: c.name_en, icon: c.icon, tint: c.tint, sort: c.sort })),
    });
  });
}
