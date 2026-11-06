import { OAuthError, SCOPE, type AuthorizeRequest } from '../../domain/oauth';
import { validationError } from '../../domain/errors';
import { json, readJson } from '../http';
import { actorOf, type Ctx, type Router } from '../router';

const oauthError = (e: OAuthError) => json({ error: e.error, error_description: e.description }, e.status);

function authorizeRequest(get: (k: string) => string | null | undefined): AuthorizeRequest {
  return {
    responseType: get('response_type') ?? '',
    clientId: get('client_id') ?? '',
    redirectUri: get('redirect_uri') ?? '',
    codeChallenge: get('code_challenge') ?? '',
    codeChallengeMethod: get('code_challenge_method') ?? '',
    state: get('state') ?? null,
    scope: get('scope') ?? SCOPE,
  };
}

/** Body of the token / register endpoints: form-encoded (standard) or JSON. */
async function readParams(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded')) {
    const out: Record<string, string> = {};
    new URLSearchParams(await req.text()).forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (type.includes('application/json')) {
    try { return (await req.json()) as Record<string, unknown>; } catch { throw new OAuthError('invalid_request', 'Body is not valid JSON'); }
  }
  throw new OAuthError('invalid_request', 'Use application/x-www-form-urlencoded or application/json');
}

const errorPage = (message: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Balance Our Day</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;background:#0F1513;color:#E6ECEA">
<h1 style="font-size:22px">เชื่อมต่อไม่สำเร็จ · Could not connect</h1><p>${message.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p></body>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

export function metadata(origin: string) {
  return {
    authorizationServer: {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      service_documentation: `${origin}/api/import/guide.md`,
    },
    protectedResource: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Balance Our Day',
    },
  };
}

export function oauthController(r: Router) {
  const asMeta = (ctx: Ctx) => metadata(ctx.url.origin);
  r.get('/.well-known/oauth-authorization-server', (ctx) => json(asMeta(ctx).authorizationServer));
  r.get('/.well-known/oauth-authorization-server/mcp', (ctx) => json(asMeta(ctx).authorizationServer));
  r.get('/.well-known/openid-configuration', (ctx) => json(asMeta(ctx).authorizationServer));
  r.get('/.well-known/oauth-protected-resource', (ctx) => json(asMeta(ctx).protectedResource));
  r.get('/.well-known/oauth-protected-resource/mcp', (ctx) => json(asMeta(ctx).protectedResource));

  r.post('/oauth/register', async (ctx) => {
    try {
      const b = await readParams(ctx.req);
      return json(await ctx.uc.oauthRegister.execute({ clientName: b.client_name, redirectUris: b.redirect_uris }), 201);
    } catch (e) {
      if (e instanceof OAuthError) return oauthError(e);
      throw e;
    }
  });

  r.get('/oauth/authorize', async (ctx) => {
    const res = await ctx.uc.oauthStart.execute(authorizeRequest((k) => ctx.url.searchParams.get(k)));
    if ('error' in res) return errorPage(res.error);
    return new Response(null, { status: 302, headers: { location: res.redirect, 'cache-control': 'no-store' } });
  });

  r.post('/oauth/token', async (ctx) => {
    try {
      const b = await readParams(ctx.req);
      const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
      const out = await ctx.uc.oauthToken.execute({
        grantType: s('grant_type'), code: s('code'), redirectUri: s('redirect_uri'), clientId: s('client_id'),
        codeVerifier: s('code_verifier'), refreshToken: s('refresh_token'),
      });
      const res = json(out);
      res.headers.set('cache-control', 'no-store');
      return res;
    } catch (e) {
      if (e instanceof OAuthError) return oauthError(e);
      throw e;
    }
  });

  // ---------- used by the website's consent page (logged-in session) ----------
  r.get('/api/oauth/consent', async (ctx) =>
    json(await ctx.uc.oauthConsent.execute(actorOf(ctx), authorizeRequest((k) => ctx.url.searchParams.get(k)))));

  r.post('/api/oauth/consent', async (ctx) => {
    const b = await readJson(ctx.req);
    if (typeof b.approve !== 'boolean') throw validationError('approve must be true or false');
    const req = authorizeRequest((k) => (typeof b[k] === 'string' ? (b[k] as string) : null));
    return json(await ctx.uc.oauthDecide.execute(actorOf(ctx), req, { approve: b.approve, autoPublish: b.autoPublish === true }));
  });
}
