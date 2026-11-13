import { json, readJson } from '../http';
import { actorOf, type Ctx, type Router } from '../router';

export function projectsController(r: Router) {
  const P = '/api/projects/:id';
  const a = (ctx: Ctx) => actorOf(ctx);
  const q = (ctx: Ctx) => ({ from: ctx.url.searchParams.get('from'), to: ctx.url.searchParams.get('to') });
  const body = (ctx: Ctx) => readJson(ctx.req) as Promise<Record<string, unknown>>;

  r.get('/api/projects', async (ctx) => json(await ctx.uc.listProjects.execute(a(ctx))));
  r.post('/api/projects', async (ctx) => json(await ctx.uc.createProject.execute(a(ctx), await body(ctx)), 201));
  r.get(P, async (ctx) => json(await ctx.uc.getProject.execute(a(ctx), ctx.params.id)));
  r.patch(P, async (ctx) => json(await ctx.uc.updateProject.execute(a(ctx), ctx.params.id, await body(ctx))));
  r.delete(P, async (ctx) => json(await ctx.uc.deleteProject.execute(a(ctx), ctx.params.id)));
  r.put(`${P}/members`, async (ctx) => json(await ctx.uc.setProjectMembers.execute(a(ctx), ctx.params.id, await body(ctx))));
  r.put(`${P}/my-days`, async (ctx) => json(await ctx.uc.setMyProjectDays.execute(a(ctx), ctx.params.id, await body(ctx))));

  r.get(`${P}/tasks`, async (ctx) => json(await ctx.uc.listTasks.execute(a(ctx), ctx.params.id)));
  r.post(`${P}/tasks`, async (ctx) => json(await ctx.uc.createTask.execute(a(ctx), ctx.params.id, await body(ctx)), 201));
  r.patch(`${P}/tasks/:tid`, async (ctx) => json(await ctx.uc.updateTask.execute(a(ctx), ctx.params.id, ctx.params.tid, await body(ctx))));
  r.delete(`${P}/tasks/:tid`, async (ctx) => json(await ctx.uc.deleteTask.execute(a(ctx), ctx.params.id, ctx.params.tid)));

  r.get(`${P}/dailies`, async (ctx) => json(await ctx.uc.listDailies.execute(a(ctx), ctx.params.id, q(ctx))));
  r.put(`${P}/dailies/:date`, async (ctx) => json(await ctx.uc.saveDaily.execute(a(ctx), ctx.params.id, ctx.params.date, await body(ctx))));
  r.delete(`${P}/dailies/:date`, async (ctx) => json(await ctx.uc.deleteDaily.execute(a(ctx), ctx.params.id, ctx.params.date)));
  r.post(`${P}/dailies/:did/replies`, async (ctx) => json(await ctx.uc.replyDaily.execute(a(ctx), ctx.params.id, ctx.params.did, await body(ctx)), 201));

  r.get(`${P}/sprints/:no`, async (ctx) => json(await ctx.uc.getSprint.execute(a(ctx), ctx.params.id, ctx.params.no)));
  r.put(`${P}/sprints/:no/review`, async (ctx) => json(await ctx.uc.saveSprintReview.execute(a(ctx), ctx.params.id, ctx.params.no, await body(ctx))));
  r.post(`${P}/sprints/:no/carry-over`, async (ctx) => json(await ctx.uc.carryOver.execute(a(ctx), ctx.params.id, ctx.params.no)));

  r.post(`${P}/versions`, async (ctx) => json(await ctx.uc.createVersion.execute(a(ctx), ctx.params.id, await body(ctx)), 201));
  r.patch(`${P}/versions/:vid`, async (ctx) => json(await ctx.uc.updateVersion.execute(a(ctx), ctx.params.id, ctx.params.vid, await body(ctx))));
  r.delete(`${P}/versions/:vid`, async (ctx) => json(await ctx.uc.deleteVersion.execute(a(ctx), ctx.params.id, ctx.params.vid)));
  r.get(`${P}/versions/:vid/changelog`, async (ctx) => json(await ctx.uc.versionChangelog.execute(a(ctx), ctx.params.id, ctx.params.vid)));

  r.get(`${P}/calendar`, async (ctx) => json(await ctx.uc.getCalendar.execute(a(ctx), ctx.params.id, q(ctx))));
  r.post(`${P}/events`, async (ctx) => json(await ctx.uc.createEvent.execute(a(ctx), ctx.params.id, await body(ctx)), 201));
  r.patch(`${P}/events/:eid`, async (ctx) => json(await ctx.uc.updateEvent.execute(a(ctx), ctx.params.id, ctx.params.eid, await body(ctx))));
  r.delete(`${P}/events/:eid`, async (ctx) => json(await ctx.uc.deleteEvent.execute(a(ctx), ctx.params.id, ctx.params.eid)));

  r.get(`${P}/retros`, async (ctx) => json(await ctx.uc.listRetros.execute(a(ctx), ctx.params.id)));
  r.post(`${P}/retros`, async (ctx) => json(await ctx.uc.createRetro.execute(a(ctx), ctx.params.id, await body(ctx)), 201));
  r.get(`${P}/retros/:rid`, async (ctx) => json(await ctx.uc.getRetro.execute(a(ctx), ctx.params.id, ctx.params.rid)));
  r.patch(`${P}/retros/:rid`, async (ctx) => json(await ctx.uc.setRetroPhase.execute(a(ctx), ctx.params.id, ctx.params.rid, await body(ctx))));
  r.delete(`${P}/retros/:rid`, async (ctx) => json(await ctx.uc.deleteRetro.execute(a(ctx), ctx.params.id, ctx.params.rid)));
  r.post(`${P}/retros/:rid/cards`, async (ctx) => json(await ctx.uc.addRetroCard.execute(a(ctx), ctx.params.id, ctx.params.rid, await body(ctx)), 201));
  r.delete(`${P}/retros/:rid/cards/:cid`, async (ctx) => json(await ctx.uc.deleteRetroCard.execute(a(ctx), ctx.params.id, ctx.params.rid, ctx.params.cid)));
  r.post(`${P}/retros/:rid/cards/:cid/vote`, async (ctx) => json(await ctx.uc.voteRetroCard.execute(a(ctx), ctx.params.id, ctx.params.rid, ctx.params.cid)));
  r.post(`${P}/retros/:rid/cards/:cid/action`, async (ctx) => json(await ctx.uc.retroAction.execute(a(ctx), ctx.params.id, ctx.params.rid, ctx.params.cid, await body(ctx))));
}
