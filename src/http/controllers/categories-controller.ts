import { asId, asInt, asString, json, optString, readJson } from '../http';
import { actorOf, type Router } from '../router';

export function categoriesController(r: Router) {
  r.get('/api/time-categories', async (ctx) => {
    actorOf(ctx);
    return json(await ctx.uc.listTimeCategories.execute());
  });

  r.post('/api/time-categories', async (ctx) => {
    const b = await readJson(ctx.req);
    const nameTh = asString(b.nameTh, 'nameTh', { min: 1, max: 40 });
    return json(await ctx.uc.createTimeCategory.execute(actorOf(ctx), {
      nameTh,
      nameEn: asString(b.nameEn ?? nameTh, 'nameEn', { min: 1, max: 40 }),
      color: asString(b.color, 'color'),
    }), 201);
  });

  r.patch('/api/time-categories/:id', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.updateTimeCategory.execute(actorOf(ctx), asId(ctx.params.id, 'Category'), {
      nameTh: optString(b.nameTh, 'nameTh', { min: 1, max: 40 }),
      nameEn: optString(b.nameEn, 'nameEn', { min: 1, max: 40 }),
      color: optString(b.color, 'color'),
      sort: b.sort === undefined ? undefined : asInt(b.sort, 'sort', 0, 1000),
    }));
  });

  r.delete('/api/time-categories/:id', async (ctx) => json(await ctx.uc.deleteTimeCategory.execute(actorOf(ctx), asId(ctx.params.id, 'Category'))));

  r.get('/api/course-categories', async (ctx) => {
    actorOf(ctx);
    return json(await ctx.uc.listCourseCategories.execute());
  });
}
