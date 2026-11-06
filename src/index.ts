// Cloudflare Worker entry point.
import { d1Container, DEFAULT_CONFIG } from './container';
import { handleRequest } from './http/app';
import type { D1Database } from './repositories/d1/db';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  /** Public website URL (consent page, links in MCP results). */
  WEB_URL?: string;
}

export function handle(req: Request, env: Env): Promise<Response> {
  return handleRequest(req, d1Container(env.DB, undefined, { webUrl: (env.WEB_URL || DEFAULT_CONFIG.webUrl).replace(/\/$/, '') }), env.ALLOWED_ORIGINS);
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
