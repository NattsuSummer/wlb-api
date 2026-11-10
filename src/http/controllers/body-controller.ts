import { json, readJson } from '../http';
import { actorOf, type Router } from '../router';

export function bodyController(r: Router) {
  r.get('/api/body', async (ctx) => json(await ctx.uc.getBodyStats.execute(actorOf(ctx))));
  r.put('/api/body/entries/:date', async (ctx) => json(await ctx.uc.saveBodyEntry.execute(actorOf(ctx), ctx.params.date, await readJson(ctx.req))));
  r.delete('/api/body/entries/:date', async (ctx) => json(await ctx.uc.deleteBodyEntry.execute(actorOf(ctx), ctx.params.date)));
  r.put('/api/body/goal', async (ctx) => json(await ctx.uc.setBodyGoal.execute(actorOf(ctx), await readJson(ctx.req))));
}
