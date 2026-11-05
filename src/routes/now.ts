import { requireUser } from '../auth';
import { json } from '../http';
import { bangkokNow } from '../lib/time';
import type { Router } from '../router';
import { listTimeCategories, listUsers } from '../store';
import { memberCard } from './users';

export function nowRoutes(r: Router) {
  // Home page: what is planned right now for me and for everyone I'm allowed to see.
  r.get('/api/now', async (ctx) => {
    const me = requireUser(ctx);
    const at = new Date();
    const cats = (await listTimeCategories(ctx.env.DB)).map((c) => c.id);
    const users = await listUsers(ctx.env.DB);
    const cards = [];
    for (const u of users) cards.push(await memberCard(ctx.env.DB, u, me.id, cats, at));
    return json({
      at: at.toISOString(),
      bangkok: bangkokNow(at),
      me: cards.find((c) => c.isMe) ?? null,
      others: cards.filter((c) => !c.isMe),
    });
  });
}
