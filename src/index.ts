// Cloudflare Worker entry point.
import { d1Container } from './container';
import { handleRequest } from './http/app';
import type { D1Database } from './repositories/d1/db';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
}

export function handle(req: Request, env: Env): Promise<Response> {
  return handleRequest(req, d1Container(env.DB), env.ALLOWED_ORIGINS);
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
