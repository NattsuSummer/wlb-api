import { requireSelfOrAdmin, requireUser } from '../auth';
import type { D1Database } from '../db';
import { asInt, asIntArray, asString, badRequest, conflict, json, notFound, readJson } from '../http';
import { maskWeek, visibility } from '../lib/privacy';
import { normalizeSlot, planRange, summarize, targetsProblem, type RangeInput, type Slot, type Week } from '../lib/schedule';
import { slotIndex } from '../lib/time';
import type { Ctx, Router } from '../router';
import { getUser, listTimeCategories, loadPrivacy, loadTargets, loadWeek, publicUser, saveCells, saveTargets } from '../store';

function parseRange(b: Record<string, unknown>): RangeInput {
  const days = asIntArray(b.days, 'days', 0, 6, { minLength: 1 });
  const from = asInt(b.from, 'from', 0, 23);
  const to = asInt(b.to, 'to', 1, 24);
  if (to <= from) throw badRequest('to must be after from');
  return { days, from, to };
}

async function parseValue(db: D1Database, b: Record<string, unknown>): Promise<Slot> {
  const valid = new Set((await listTimeCategories(db)).map((c) => c.id));
  const ids = asIntArray(b.categoryIds, 'categoryIds', 1, Number.MAX_SAFE_INTEGER, { minLength: 1 });
  const bad = ids.filter((id) => !valid.has(id));
  if (bad.length) throw badRequest(`Unknown category id(s): ${bad.join(', ')}`);
  return normalizeSlot(ids, asString(b.description, 'description', { optional: true, max: 80 }));
}

async function targetUser(ctx: Ctx) {
  const id = Number(ctx.params.userId);
  if (!Number.isInteger(id)) throw notFound('User not found');
  const u = await getUser(ctx.env.DB, id);
  if (!u || u.disabled) throw notFound('User not found');
  return u;
}

const cellsOf = (week: Week, r: RangeInput) => {
  const out: { weekday: number; hour: number; slot: Slot | null }[] = [];
  for (const d of r.days) for (let h = r.from; h < r.to; h++) out.push({ weekday: d, hour: h, slot: week[slotIndex(d, h)] ?? null });
  return out;
};

async function scheduleView(db: D1Database, userId: number, viewerId: number) {
  const isOwner = userId === viewerId;
  const [privacy, cats] = [await loadPrivacy(db, userId), await listTimeCategories(db)];
  const schedLevel = visibility(privacy, 'schedule', isOwner);
  const sumLevel = visibility(privacy, 'summary', isOwner);
  const week = await loadWeek(db, userId);
  const targets = await loadTargets(db, userId);
  return {
    visible: { schedule: schedLevel, summary: sumLevel },
    week: schedLevel === 'hide' ? null : maskWeek(week, schedLevel),
    targets: sumLevel === 'hide' ? null : targets,
    summary: sumLevel === 'hide' ? null : summarize(week, cats.map((c) => c.id), targets),
  };
}

export function scheduleRoutes(r: Router) {
  r.get('/api/schedules/:userId', async (ctx) => {
    const me = requireUser(ctx);
    const u = await targetUser(ctx);
    const view = await scheduleView(ctx.env.DB, u.id, me.id);
    return json({ user: publicUser(u), editable: me.id === u.id || me.role === 'admin', ...view });
  });

  // Dry run: what would change? Used by the editor to show overwrite warnings and the before/after preview.
  r.post('/api/schedules/:userId/preview', async (ctx) => {
    const u = await targetUser(ctx);
    requireSelfOrAdmin(ctx, u.id);
    const b = await readJson(ctx.req);
    const range = parseRange(b);
    const value = b.clear === true ? null : await parseValue(ctx.env.DB, b);
    const week = await loadWeek(ctx.env.DB, u.id);
    const plan = planRange(week, range, value);
    return json({ overwrites: plan.overwrites, overwriteCount: plan.overwriteCount, fillCount: plan.fillCount, unchangedCount: plan.unchangedCount });
  });

  // Write one value to a range. If planned cells would be replaced, the client must send confirmOverwrite: true.
  r.put('/api/schedules/:userId/range', async (ctx) => {
    const u = await targetUser(ctx);
    const me = requireSelfOrAdmin(ctx, u.id);
    const b = await readJson(ctx.req);
    const range = parseRange(b);
    const value = await parseValue(ctx.env.DB, b);
    const week = await loadWeek(ctx.env.DB, u.id);
    const plan = planRange(week, range, value);
    if (plan.overwriteCount > 0 && b.confirmOverwrite !== true) {
      throw conflict('overwrite_needs_confirm', `This replaces ${plan.overwriteCount} planned hour(s)`, { overwrites: plan.overwrites, overwriteCount: plan.overwriteCount });
    }
    const undo = cellsOf(week, range);
    await saveCells(ctx.env.DB, u.id, cellsOf(plan.after, range));
    return json({ undo, overwriteCount: plan.overwriteCount, fillCount: plan.fillCount, ...(await scheduleView(ctx.env.DB, u.id, me.id)) });
  });

  // Clear a range (the editor sends the original block that was picked, not the edited range).
  r.post('/api/schedules/:userId/clear', async (ctx) => {
    const u = await targetUser(ctx);
    const me = requireSelfOrAdmin(ctx, u.id);
    const range = parseRange(await readJson(ctx.req));
    const week = await loadWeek(ctx.env.DB, u.id);
    const undo = cellsOf(week, range);
    const cleared = undo.filter((c) => c.slot !== null).length;
    await saveCells(ctx.env.DB, u.id, undo.map((c) => ({ ...c, slot: null })));
    return json({ undo, clearedCount: cleared, ...(await scheduleView(ctx.env.DB, u.id, me.id)) });
  });

  // Set exact cells — used by "undo" to restore the cells returned by range/clear.
  r.put('/api/schedules/:userId/cells', async (ctx) => {
    const u = await targetUser(ctx);
    const me = requireSelfOrAdmin(ctx, u.id);
    const b = await readJson(ctx.req);
    if (!Array.isArray(b.cells) || b.cells.length === 0 || b.cells.length > 168) throw badRequest('cells must be an array of 1–168 items');
    const valid = new Set((await listTimeCategories(ctx.env.DB)).map((c) => c.id));
    const cells = b.cells.map((c: Record<string, unknown>, i: number) => {
      const weekday = asInt(c.weekday, `cells[${i}].weekday`, 0, 6);
      const hour = asInt(c.hour, `cells[${i}].hour`, 0, 23);
      if (c.slot === null || c.slot === undefined) return { weekday, hour, slot: null };
      const s = c.slot as Record<string, unknown>;
      const ids = asIntArray(s.categoryIds, `cells[${i}].slot.categoryIds`, 1, Number.MAX_SAFE_INTEGER, { minLength: 1 });
      if (ids.some((id) => !valid.has(id))) throw badRequest(`cells[${i}] has an unknown category`);
      return { weekday, hour, slot: normalizeSlot(ids, asString(s.description, 'description', { optional: true, max: 80 })) };
    });
    await saveCells(ctx.env.DB, u.id, cells);
    return json(await scheduleView(ctx.env.DB, u.id, me.id));
  });

  r.put('/api/schedules/:userId/targets', async (ctx) => {
    const u = await targetUser(ctx);
    const me = requireSelfOrAdmin(ctx, u.id);
    const b = await readJson(ctx.req);
    if (!b.targets || typeof b.targets !== 'object') throw badRequest('targets must be an object { categoryId: pct }');
    const valid = new Set((await listTimeCategories(ctx.env.DB)).map((c) => c.id));
    const targets: Record<number, number> = {};
    for (const [k, v] of Object.entries(b.targets as Record<string, unknown>)) {
      const id = Number(k);
      if (!valid.has(id)) throw badRequest(`Unknown category id: ${k}`);
      targets[id] = v as number;
    }
    const problem = targetsProblem(targets);
    if (problem) throw badRequest(problem);
    await saveTargets(ctx.env.DB, u.id, targets);
    return json(await scheduleView(ctx.env.DB, u.id, me.id));
  });
}
