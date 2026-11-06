import { asEnum, asId, asString, json, optEnum, optString, readJson } from '../http';
import { actorOf, type Router } from '../router';

export function usersController(r: Router) {
  r.get('/api/users', async (ctx) => json(await ctx.uc.listMembers.execute(actorOf(ctx))));

  r.get('/api/admin/users', async (ctx) => json(await ctx.uc.adminListUsers.execute(actorOf(ctx))));

  r.post('/api/admin/users', async (ctx) => {
    const b = await readJson(ctx.req);
    const username = asString(b.username, 'username', { min: 2, max: 32 });
    return json(await ctx.uc.adminCreateUser.execute(actorOf(ctx), {
      username,
      displayName: asString(b.displayName ?? username, 'displayName', { min: 1, max: 40 }),
      password: asString(b.password, 'password', { min: 1, max: 200 }),
      role: asEnum(b.role ?? 'member', 'role', ['admin', 'member'] as const),
    }), 201);
  });

  r.patch('/api/admin/users/:id', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.adminUpdateUser.execute(actorOf(ctx), asId(ctx.params.id, 'User'), {
      displayName: optString(b.displayName, 'displayName', { min: 1, max: 40 }),
      role: optEnum(b.role, 'role', ['admin', 'member'] as const),
      disabled: b.disabled === undefined ? undefined : b.disabled === true,
    }));
  });

  r.post('/api/admin/users/:id/reset-password', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.adminResetPassword.execute(actorOf(ctx), asId(ctx.params.id, 'User'), asString(b.password, 'password', { min: 8, max: 200 })));
  });

  r.get('/api/admin/tokens', async (ctx) => json(await ctx.uc.adminListTokens.execute(actorOf(ctx))));
  r.delete('/api/admin/tokens/:id', async (ctx) => json(await ctx.uc.adminRevokeToken.execute(actorOf(ctx), ctx.params.id!)));
}
