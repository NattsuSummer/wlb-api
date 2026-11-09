import { STATUSES, VISIBILITIES } from '../../domain/course';
import { validationError } from '../../domain/errors';
import { asId, asInt, json, optEnum, readJson } from '../http';
import { actorOf, type Ctx, type Router } from '../router';

const statusParam = (ctx: Ctx) => optEnum(ctx.url.searchParams.get('status') ?? undefined, 'status', STATUSES);

export function routinesController(r: Router) {
  r.get('/api/routines', async (ctx) => json(await ctx.uc.listRoutines.execute(actorOf(ctx))));
  r.get('/api/routines/week', async (ctx) => json(await ctx.uc.myRoutineWeek.execute(actorOf(ctx))));
  r.post('/api/routines/validate', async (ctx) => json(await ctx.uc.validateRoutines.execute(actorOf(ctx), await readJson(ctx.req))));
  r.post('/api/routines/import', async (ctx) => json(await ctx.uc.importRoutines.execute(actorOf(ctx), await readJson(ctx.req), { status: statusParam(ctx) }), 201));
  // Public on purpose: an AI can be pointed at this URL. No user data in it.
  r.get('/api/routines/guide.md', (ctx) =>
    new Response(ctx.uc.getRoutineGuide.execute(), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' } }));

  for (const what of ['item', 'plan'] as const) {
    const base = `/api/routines/${what}s/:id`;
    const id = (ctx: Ctx) => asId(ctx.params.id, what === 'item' ? 'Item' : 'Plan');
    r.get(base, async (ctx) => json(what === 'item' ? await ctx.uc.getRoutineItem.execute(actorOf(ctx), id(ctx)) : await ctx.uc.getRoutinePlan.execute(actorOf(ctx), id(ctx))));
    r.get(`${base}/export`, async (ctx) =>
      json(what === 'item' ? await ctx.uc.exportRoutineItem.execute(actorOf(ctx), id(ctx)) : await ctx.uc.exportRoutinePlan.execute(actorOf(ctx), id(ctx))));
    r.put(base, async (ctx) => {
      const body = await readJson(ctx.req);
      return json(what === 'item' ? await ctx.uc.updateRoutineItem.execute(actorOf(ctx), id(ctx), body) : await ctx.uc.updateRoutinePlan.execute(actorOf(ctx), id(ctx), body));
    });
    r.patch(base, async (ctx) => {
      const b = await readJson(ctx.req);
      return json(await ctx.uc.patchRoutine.execute(actorOf(ctx), what, id(ctx), {
        visibility: optEnum(b.visibility, 'visibility', VISIBILITIES), status: optEnum(b.status, 'status', STATUSES),
      }));
    });
    r.delete(base, async (ctx) => json(await ctx.uc.deleteRoutine.execute(actorOf(ctx), what, id(ctx))));
  }

  r.put('/api/routines/plans/:id/days', async (ctx) => {
    const b = await readJson(ctx.req);
    if (!Array.isArray(b.days) || b.days.length > 7 * 25) throw validationError('days must be a list of { weekday, hour }');
    const days = b.days.map((d: unknown, i: number) => {
      if (typeof d !== 'object' || d === null) throw validationError(`days[${i}] must be an object`);
      const o = d as Record<string, unknown>;
      return { weekday: asInt(o.weekday, `days[${i}].weekday`, 0, 6), hour: o.hour === null || o.hour === undefined ? null : asInt(o.hour, `days[${i}].hour`, 0, 23) };
    });
    return json(await ctx.uc.setRoutineDays.execute(actorOf(ctx), asId(ctx.params.id, 'Plan'), days));
  });
}
