import { validationError } from '../../domain/errors';
import type { RangeInput } from '../../domain/schedule';
import type { CellInput, SlotInput } from '../../usecases/schedules';
import { asId, asInt, asIntArray, asString, json, readJson } from '../http';
import { actorOf, type Router } from '../router';

function range(b: Record<string, unknown>): RangeInput {
  const days = asIntArray(b.days, 'days', 0, 6, { minLength: 1 });
  const from = asInt(b.from, 'from', 0, 23);
  const to = asInt(b.to, 'to', 1, 24);
  if (to <= from) throw validationError('to must be after from');
  return { days, from, to };
}

const slot = (b: Record<string, unknown>, prefix = ''): SlotInput => ({
  categoryIds: asIntArray(b.categoryIds, `${prefix}categoryIds`, 1, Number.MAX_SAFE_INTEGER, { minLength: 1 }),
  description: asString(b.description, `${prefix}description`, { optional: true, max: 80 }),
});

export function schedulesController(r: Router) {
  const owner = (p: Record<string, string>) => asId(p.userId, 'User');

  r.get('/api/schedules/:userId', async (ctx) => json(await ctx.uc.getSchedule.execute(actorOf(ctx), owner(ctx.params))));

  r.post('/api/schedules/:userId/preview', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.previewRange.execute(actorOf(ctx), owner(ctx.params), range(b), b.clear === true ? null : slot(b)));
  });

  r.put('/api/schedules/:userId/range', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.writeRange.execute(actorOf(ctx), owner(ctx.params), range(b), slot(b), b.confirmOverwrite === true));
  });

  r.post('/api/schedules/:userId/clear', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.clearRange.execute(actorOf(ctx), owner(ctx.params), range(b)));
  });

  r.put('/api/schedules/:userId/cells', async (ctx) => {
    const b = await readJson(ctx.req);
    if (!Array.isArray(b.cells) || b.cells.length === 0 || b.cells.length > 168) throw validationError('cells must be an array of 1–168 items');
    const cells: CellInput[] = b.cells.map((c: Record<string, unknown>, i: number) => ({
      weekday: asInt(c.weekday, `cells[${i}].weekday`, 0, 6),
      hour: asInt(c.hour, `cells[${i}].hour`, 0, 23),
      slot: c.slot === null || c.slot === undefined ? null : slot(c.slot as Record<string, unknown>, `cells[${i}].slot.`),
    }));
    return json(await ctx.uc.setCells.execute(actorOf(ctx), owner(ctx.params), cells));
  });

  r.put('/api/schedules/:userId/targets', async (ctx) => {
    const b = await readJson(ctx.req);
    if (!b.targets || typeof b.targets !== 'object') throw validationError('targets must be an object { categoryId: pct }');
    const targets: Record<number, number> = {};
    for (const [k, v] of Object.entries(b.targets as Record<string, unknown>)) targets[Number(k)] = v as number;
    return json(await ctx.uc.setTargets.execute(actorOf(ctx), owner(ctx.params), targets));
  });
}
