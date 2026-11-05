import { authenticate } from './auth';
import type { Env } from './db';
import { corsHeaders, errorResponse, forbidden, HttpError, json, notFound } from './http';
import { Router } from './router';
import { authRoutes } from './routes/auth';
import { categoryRoutes } from './routes/categories';
import { meRoutes } from './routes/me';
import { nowRoutes } from './routes/now';
import { scheduleRoutes } from './routes/schedules';
import { userRoutes } from './routes/users';

export const router = new Router();
router.get('/api/health', () => json({ ok: true, service: 'balance-our-day-api' }));
authRoutes(router);
meRoutes(router);
userRoutes(router);
categoryRoutes(router);
scheduleRoutes(router);
nowRoutes(router);

// While a user must change their password, only these endpoints work.
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['/api/me', '/api/me/password', '/api/auth/logout']);

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req, env.ALLOWED_ORIGINS);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  let res: Response;
  try {
    const m = router.match(req.method, url.pathname);
    if (!m) throw notFound(`No route for ${url.pathname}`);
    if (m === 'method_not_allowed') throw new HttpError(405, 'method_not_allowed', `${req.method} not allowed`);
    const user = await authenticate(req, env.DB);
    if (user?.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(url.pathname)) {
      throw forbidden('Please set a new password first');
    }
    res = await m.handler({ req, env, url, params: m.params, user });
  } catch (err) {
    res = errorResponse(err);
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
