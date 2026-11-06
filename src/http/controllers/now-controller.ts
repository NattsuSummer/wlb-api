import { json } from '../http';
import { actorOf, type Router } from '../router';

export function nowController(r: Router) {
  r.get('/api/now', async (ctx) => json(await ctx.uc.getNow.execute(actorOf(ctx))));
}
