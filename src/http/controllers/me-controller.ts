import { validationError } from '../../domain/errors';
import { HEX_COLOR_RE } from '../../domain/user';
import { asEnum, asString, json, optEnum, optString, readJson } from '../http';
import { actorOf, type Router } from '../router';

export function meController(r: Router) {
  r.get('/api/me', async (ctx) => json(await ctx.uc.getMe.execute(actorOf(ctx))));

  r.patch('/api/me', async (ctx) => {
    const b = await readJson(ctx.req);
    const avatarColor = optString(b.avatarColor, 'avatarColor');
    if (avatarColor !== undefined && !HEX_COLOR_RE.test(avatarColor)) throw validationError('avatarColor must be #RRGGBB');
    return json(await ctx.uc.updateProfile.execute(actorOf(ctx), {
      displayName: optString(b.displayName, 'displayName', { min: 1, max: 40 }),
      locale: optEnum(b.locale, 'locale', ['th', 'en'] as const),
      theme: optEnum(b.theme, 'theme', ['dark', 'light', 'system'] as const),
      avatarColor,
    }));
  });

  r.get('/api/me/privacy', async (ctx) => json(await ctx.uc.getPrivacy.execute(actorOf(ctx))));

  r.put('/api/me/privacy', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.updatePrivacy.execute(actorOf(ctx), {
      privateMode: b.privateMode === true,
      schedule: asEnum(b.schedule, 'schedule', ['full', 'cat', 'hide'] as const),
      nowStatus: asEnum(b.nowStatus, 'nowStatus', ['full', 'cat', 'hide'] as const),
      summary: asEnum(b.summary, 'summary', ['show', 'hide'] as const),
      courses: asEnum(b.courses, 'courses', ['show', 'hide'] as const),
      answers: asEnum(b.answers, 'answers', ['show', 'hide'] as const),
    }));
  });

  r.get('/api/me/tokens', async (ctx) => json(await ctx.uc.listMyTokens.execute(actorOf(ctx))));

  r.post('/api/me/tokens', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.createApiToken.execute(actorOf(ctx), asString(b.name, 'name', { min: 1, max: 60 })), 201);
  });

  r.delete('/api/me/tokens/:id', async (ctx) => json(await ctx.uc.revokeMyToken.execute(actorOf(ctx), ctx.params.id!)));
}
