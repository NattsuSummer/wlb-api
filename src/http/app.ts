// HTTP entry: CORS, auth, the forced-password-change gate, routing and error mapping.
import type { Container } from '../container';
import { forbiddenError, notFoundError } from '../domain/errors';
import { authController } from './controllers/auth-controller';
import { coursesController } from './controllers/courses-controller';
import { mcpController } from './controllers/mcp-controller';
import { routinesController } from './controllers/routines-controller';
import { bodyController } from './controllers/body-controller';
import { oauthController } from './controllers/oauth-controller';
import { categoriesController } from './controllers/categories-controller';
import { meController } from './controllers/me-controller';
import { nowController } from './controllers/now-controller';
import { schedulesController } from './controllers/schedules-controller';
import { usersController } from './controllers/users-controller';
import { corsHeaders, errorResponse, HttpError, json } from './http';
import { Router } from './router';

export const router = new Router();
router.get('/api/health', () => json({ ok: true, service: 'balance-our-day-api' }));
authController(router);
meController(router);
usersController(router);
categoriesController(router);
schedulesController(router);
nowController(router);
coursesController(router);
oauthController(router);
mcpController(router);
routinesController(router);
bodyController(router);

// While a user must change their password, only these endpoints work.
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['/api/me', '/api/me/password', '/api/auth/logout']);

// OAuth discovery, registration, token and MCP endpoints are called by other apps (no cookies are used): any origin.
const isPublic = (p: string) => p.startsWith('/.well-known/') || p.startsWith('/oauth/') || p === '/mcp' || p === '/api/import/guide.md' || p === '/api/routines/guide.md';
const PUBLIC_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '86400',
};

export async function handleRequest(req: Request, container: Container, allowedOrigins?: string): Promise<Response> {
  const url = new URL(req.url);
  const cors = isPublic(url.pathname) ? PUBLIC_CORS : corsHeaders(req, allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  let res: Response;
  try {
    const m = router.match(req.method, url.pathname);
    if (!m) throw notFoundError(`No route for ${url.pathname}`);
    if (m === 'method_not_allowed') throw new HttpError(405, 'method_not_allowed', `${req.method} not allowed`);
    const actor = await container.usecases.authenticate.execute(req.headers.get('authorization'));
    if (actor?.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(url.pathname)) throw forbiddenError('Please set a new password first');
    res = await m.handler({ req, url, params: m.params, actor, uc: container.usecases });
  } catch (err) {
    res = errorResponse(err);
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}
