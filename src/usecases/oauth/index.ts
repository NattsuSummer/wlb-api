// OAuth 2.1 authorization server for the MCP connector.
// Flow: client registers → /oauth/authorize redirects to the website's consent page → the logged-in user approves
// (POST /api/oauth/approve) → client exchanges the code (+ PKCE verifier) at /oauth/token → access + refresh token.
import { forbiddenError, validationError } from '../../domain/errors';
import {
  ACCESS_DAYS, clientProblem, CODE_MINUTES, MAX_REDIRECT_URIS, OAuthError, pkceMatches, redirectUriProblem, REFRESH_DAYS, requestProblem,
  SCOPE, withQuery, type AuthorizeRequest,
} from '../../domain/oauth';
import type { Actor } from '../../domain/user';
import { randomToken, sha256Hex } from '../../services/token-service';
import type { Deps } from '../deps';

const DAY_MS = 86_400_000;

export class RegisterClientUseCase {
  constructor(private d: Deps) {}
  async execute(input: { clientName?: unknown; redirectUris?: unknown }) {
    const uris = input.redirectUris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every((u) => typeof u === 'string')) {
      throw new OAuthError('invalid_redirect_uri', `redirect_uris must be a list of 1–${MAX_REDIRECT_URIS} URLs`);
    }
    for (const u of uris as string[]) {
      const p = redirectUriProblem(u);
      if (p) throw new OAuthError('invalid_redirect_uri', p);
    }
    const name = typeof input.clientName === 'string' && input.clientName.trim() ? input.clientName.trim().slice(0, 80) : 'AI assistant';
    const id = randomToken('wlc_');
    await this.d.repos.oauth.createClient({ id, name, redirectUris: uris as string[] });
    return {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(this.d.clock.now().getTime() / 1000),
    };
  }
}

/** GET /oauth/authorize → where to send the browser. Bad client/redirect → an error page, never a redirect. */
export class StartAuthorizeUseCase {
  constructor(private d: Deps) {}
  async execute(req: AuthorizeRequest): Promise<{ redirect: string } | { error: string }> {
    const client = await this.d.repos.oauth.findClient(req.clientId);
    const bad = clientProblem(req, client);
    if (bad) return { error: bad };
    const problem = requestProblem(req);
    if (problem) return { redirect: withQuery(req.redirectUri, { error: problem, state: req.state }) };
    return {
      redirect: withQuery(`${this.d.config.webUrl}/oauth/consent`, {
        response_type: req.responseType, client_id: req.clientId, redirect_uri: req.redirectUri,
        code_challenge: req.codeChallenge, code_challenge_method: req.codeChallengeMethod, state: req.state, scope: req.scope,
      }),
    };
  }
}

/** What the consent page shows. */
export class GetConsentUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, req: AuthorizeRequest) {
    const client = await this.d.repos.oauth.findClient(req.clientId);
    const bad = clientProblem(req, client) ?? (requestProblem(req) ? 'Invalid authorization request' : null);
    if (bad) throw validationError(bad, undefined, 'invalid_request');
    return { client: { name: client!.name, redirectHost: new URL(req.redirectUri).host }, user: { username: actor.username, displayName: actor.displayName } };
  }
}

/** The user pressed Allow or Deny on the consent page (must be a real login session, not an API token). */
export class DecideConsentUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, req: AuthorizeRequest, decision: { approve: boolean; autoPublish: boolean }) {
    if (actor.tokenKind !== 'session') throw forbiddenError('Approve connections from a logged-in browser session');
    await new GetConsentUseCase(this.d).execute(actor, req);
    if (!decision.approve) return { redirect: withQuery(req.redirectUri, { error: 'access_denied', state: req.state }) };
    const code = randomToken('wlo_');
    await this.d.repos.oauth.saveCode({
      codeHash: await sha256Hex(code), clientId: req.clientId, userId: actor.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge,
      scope: SCOPE, autoPublish: decision.autoPublish, expiresAt: new Date(this.d.clock.now().getTime() + CODE_MINUTES * 60_000).toISOString(),
    });
    return { redirect: withQuery(req.redirectUri, { code, state: req.state }) };
  }
}

export interface TokenRequest {
  grantType?: string; code?: string; redirectUri?: string; clientId?: string; codeVerifier?: string; refreshToken?: string;
}

/** POST /oauth/token: authorization_code (with PKCE) or refresh_token (rotating). */
export class TokenUseCase {
  constructor(private d: Deps) {}
  async execute(r: TokenRequest) {
    if (r.grantType === 'authorization_code') return this.fromCode(r);
    if (r.grantType === 'refresh_token') return this.fromRefresh(r);
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  }

  private async fromCode(r: TokenRequest) {
    if (!r.code || !r.codeVerifier || !r.clientId || !r.redirectUri) throw new OAuthError('invalid_request', 'code, code_verifier, client_id and redirect_uri are required');
    const c = await this.d.repos.oauth.takeCode(await sha256Hex(r.code));
    const now = this.d.clock.now();
    if (!c || Date.parse(c.expiresAt) < now.getTime()) throw new OAuthError('invalid_grant', 'Code is invalid or expired');
    if (c.clientId !== r.clientId || c.redirectUri !== r.redirectUri) throw new OAuthError('invalid_grant', 'Code was issued to another client or redirect_uri');
    if (!(await pkceMatches(r.codeVerifier, c.codeChallenge))) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    const client = await this.d.repos.oauth.findClient(c.clientId);
    const access = await this.d.tokens.issue(c.userId, 'api', { days: ACCESS_DAYS, name: `${client?.name ?? 'AI'} (MCP)` });
    const refresh = randomToken('wlr_');
    await this.d.repos.oauth.createGrant({
      clientId: c.clientId, userId: c.userId, refreshHash: await sha256Hex(refresh), accessTokenId: access.id, scope: c.scope,
      autoPublish: c.autoPublish, refreshExpiresAt: new Date(now.getTime() + REFRESH_DAYS * DAY_MS).toISOString(),
    });
    return this.response(access.token, refresh, c.scope);
  }

  private async fromRefresh(r: TokenRequest) {
    if (!r.refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
    const g = await this.d.repos.oauth.findGrantByRefresh(await sha256Hex(r.refreshToken));
    const now = this.d.clock.now();
    if (!g || Date.parse(g.refreshExpiresAt) < now.getTime() || (r.clientId && r.clientId !== g.clientId)) throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired');
    const user = await this.d.repos.users.findById(g.userId);
    if (!user || user.disabled) throw new OAuthError('invalid_grant', 'Account is not active');
    const client = await this.d.repos.oauth.findClient(g.clientId);
    const access = await this.d.tokens.issue(g.userId, 'api', { days: ACCESS_DAYS, name: `${client?.name ?? 'AI'} (MCP)` });
    const refresh = randomToken('wlr_');
    await this.d.repos.oauth.rotateGrant(g.id, await sha256Hex(refresh), access.id, new Date(now.getTime() + REFRESH_DAYS * DAY_MS).toISOString());
    return this.response(access.token, refresh, g.scope);
  }

  private response(accessToken: string, refreshToken: string, scope: string) {
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_DAYS * 86_400, refresh_token: refreshToken, scope };
  }
}
