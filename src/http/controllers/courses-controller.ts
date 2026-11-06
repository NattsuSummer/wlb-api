import { STATUSES, VISIBILITIES } from '../../domain/course';
import { validationError } from '../../domain/errors';
import { asId, asInt, asString, json, optEnum, optString, readJson } from '../http';
import { actorOf, type Ctx, type Router } from '../router';

const statusParam = (ctx: Ctx) => optEnum(ctx.url.searchParams.get('status') ?? undefined, 'status', STATUSES);
const optId = (v: unknown, field: string) => (v === undefined ? undefined : v === null ? null : asInt(v, field, 1, Number.MAX_SAFE_INTEGER));
const optUrl = (v: unknown, field: string) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = asString(v, field, { max: 1000 });
  if (!/^https?:\/\/\S+$/i.test(s)) throw validationError(`${field} must be an http(s) URL`);
  return s;
};

export function coursesController(r: Router) {
  // ---------- catalog and learning ----------
  r.get('/api/courses', async (ctx) => json(await ctx.uc.listCatalog.execute(actorOf(ctx))));
  r.get('/api/admin/courses', async (ctx) => json(await ctx.uc.adminListCourses.execute(actorOf(ctx))));
  r.get('/api/courses/:id', async (ctx) => json(await ctx.uc.getCourse.execute(actorOf(ctx), asId(ctx.params.id, 'Course'))));
  r.get('/api/courses/:id/export', async (ctx) => json(await ctx.uc.exportCourse.execute(actorOf(ctx), asId(ctx.params.id, 'Course'))));
  r.get('/api/lessons/:id', async (ctx) => json(await ctx.uc.getLesson.execute(actorOf(ctx), asId(ctx.params.id, 'Lesson'))));

  r.post('/api/lessons/:id/complete', async (ctx) => {
    const b = ctx.req.headers.get('content-type')?.includes('json') ? await readJson(ctx.req) : {};
    if (b.done !== undefined && typeof b.done !== 'boolean') throw validationError('done must be true or false');
    return json(await ctx.uc.setLessonComplete.execute(actorOf(ctx), asId(ctx.params.id, 'Lesson'), b.done !== false));
  });

  r.post('/api/exercises/:id/attempt', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.attemptExercise.execute(actorOf(ctx), asId(ctx.params.id, 'Exercise'), b.answer));
  });

  // ---------- create / edit (body = course in the import format, see GET /api/import/guide.md) ----------
  const create = async (ctx: Ctx) => json(await ctx.uc.importCourse.execute(actorOf(ctx), await readJson(ctx.req), { status: statusParam(ctx) }), 201);
  r.post('/api/courses', create);
  r.post('/api/import/course', create);
  r.post('/api/import/validate', async (ctx) => json(await ctx.uc.validateCourse.execute(actorOf(ctx), await readJson(ctx.req))));
  r.put('/api/courses/:id', async (ctx) =>
    json(await ctx.uc.updateCourse.execute(actorOf(ctx), asId(ctx.params.id, 'Course'), await readJson(ctx.req), { status: statusParam(ctx) })));

  r.patch('/api/courses/:id', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.patchCourse.execute(actorOf(ctx), asId(ctx.params.id, 'Course'), {
      visibility: optEnum(b.visibility, 'visibility', VISIBILITIES),
      status: optEnum(b.status, 'status', STATUSES),
      packId: optId(b.packId, 'packId'),
      orderInPack: b.orderInPack === undefined || b.orderInPack === null ? undefined : asInt(b.orderInPack, 'orderInPack', 1, 1000),
    }));
  });

  r.delete('/api/courses/:id', async (ctx) => json(await ctx.uc.deleteCourse.execute(actorOf(ctx), asId(ctx.params.id, 'Course'))));

  // Public on purpose: an AI can be pointed at this URL. It contains no user data.
  r.get('/api/import/guide.md', async (ctx) =>
    new Response(await ctx.uc.getImportGuide.execute(), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' } }));

  // ---------- packs ----------
  r.get('/api/packs', async (ctx) => {
    actorOf(ctx);
    return json(await ctx.uc.listPacks.execute());
  });
  r.post('/api/packs', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.createPack.execute(actorOf(ctx), {
      title: asString(b.title, 'title', { min: 1, max: 120 }),
      description: optString(b.description, 'description', { max: 2000 }),
      categoryId: optId(b.categoryId, 'categoryId'),
      coverUrl: optUrl(b.coverUrl, 'coverUrl'),
    }), 201);
  });
  r.patch('/api/packs/:id', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.updatePack.execute(actorOf(ctx), asId(ctx.params.id, 'Pack'), {
      title: optString(b.title, 'title', { min: 1, max: 120 }),
      description: optString(b.description, 'description', { max: 2000 }),
      categoryId: optId(b.categoryId, 'categoryId'),
      coverUrl: optUrl(b.coverUrl, 'coverUrl'),
    }));
  });
  r.delete('/api/packs/:id', async (ctx) => json(await ctx.uc.deletePack.execute(actorOf(ctx), asId(ctx.params.id, 'Pack'))));

  // ---------- course categories (admin) ----------
  r.post('/api/course-categories', async (ctx) => {
    const b = await readJson(ctx.req);
    const nameTh = asString(b.nameTh, 'nameTh', { min: 1, max: 40 });
    return json(await ctx.uc.createCourseCategory.execute(actorOf(ctx), {
      nameTh,
      nameEn: optString(b.nameEn, 'nameEn', { min: 1, max: 40 }),
      icon: optString(b.icon, 'icon', { min: 1, max: 20 }),
      tint: optString(b.tint, 'tint'),
    }), 201);
  });
  r.patch('/api/course-categories/:id', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.updateCourseCategory.execute(actorOf(ctx), asId(ctx.params.id, 'Category'), {
      nameTh: optString(b.nameTh, 'nameTh', { min: 1, max: 40 }),
      nameEn: optString(b.nameEn, 'nameEn', { min: 1, max: 40 }),
      icon: optString(b.icon, 'icon', { min: 1, max: 20 }),
      tint: optString(b.tint, 'tint'),
      sort: b.sort === undefined ? undefined : asInt(b.sort, 'sort', 0, 1000),
    }));
  });
  r.delete('/api/course-categories/:id', async (ctx) => json(await ctx.uc.deleteCourseCategory.execute(actorOf(ctx), asId(ctx.params.id, 'Category'))));
}
