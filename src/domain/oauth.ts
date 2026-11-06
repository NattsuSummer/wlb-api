// OAuth 2.1 rules for the MCP connector: public clients, authorization code + PKCE (S256), refresh rotation.

export const SCOPE = 'courses';
export const CODE_MINUTES = 10;
export const ACCESS_DAYS = 30;
export const REFRESH_DAYS = 180;
export const MAX_REDIRECT_URIS = 10;

export interface OAuthClient { id: string; name: string; redirectUris: string[]; createdAt: string }

export interface AuthorizeRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string;
}

/** Redirect URIs must be https, or http on the loopback interface (desktop clients). No fragments. */
export function redirectUriProblem(uri: string): string | null {
  let u: URL;
  try { u = new URL(uri); } catch { return `invalid redirect_uri: ${uri}`; }
  if (u.hash) return 'redirect_uri must not contain a fragment';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
  return 'redirect_uri must use https (or http://localhost)';
}

/** Problems that mean we must NOT redirect back (unknown client / unregistered redirect). */
export function clientProblem(req: AuthorizeRequest, client: OAuthClient | null): string | null {
  if (!client) return 'Unknown client_id. The app must register first.';
  if (!client.redirectUris.includes(req.redirectUri)) return 'redirect_uri is not registered for this client';
  return null;
}

/** Problems that are reported back to the client via the redirect (?error=…). */
export function requestProblem(req: AuthorizeRequest): string | null {
  if (req.responseType !== 'code') return 'unsupported_response_type';
  if (!req.codeChallenge || req.codeChallengeMethod !== 'S256') return 'invalid_request';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(req.codeChallenge)) return 'invalid_request';
  return null;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return (await pkceChallenge(verifier)) === challenge;
}

export function withQuery(base: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** RFC 6749 error for the token endpoint. */
export class OAuthError extends Error {
  constructor(public error: string, public description: string, public status = 400) { super(description); }
}
