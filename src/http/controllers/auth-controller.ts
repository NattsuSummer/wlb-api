import { asString, json, readJson } from '../http';
import { actorOf, type Router } from '../router';

export function authController(r: Router) {
  r.post('/api/auth/login', async ({ req, uc }) => {
    const b = await readJson(req);
    return json(await uc.login.execute({
      username: asString(b.username, 'username', { min: 1, max: 64 }),
      password: asString(b.password, 'password', { min: 1, max: 200 }),
      remember: b.remember === true,
    }));
  });

  r.post('/api/auth/logout', async (ctx) => json(await ctx.uc.logout.execute(actorOf(ctx))));

  r.post('/api/me/password', async (ctx) => {
    const b = await readJson(ctx.req);
    return json(await ctx.uc.changePassword.execute(actorOf(ctx), {
      currentPassword: asString(b.currentPassword, 'currentPassword', { min: 1, max: 200 }),
      newPassword: typeof b.newPassword === 'string' ? b.newPassword : '',
    }));
  });
}
