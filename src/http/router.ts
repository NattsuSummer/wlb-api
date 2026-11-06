import type { Container } from '../container';
import { unauthorizedError } from '../domain/errors';
import type { Actor } from '../domain/user';

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  actor: Actor | null;
  uc: Container['usecases'];
}

/** The logged-in actor, or 401. */
export function actorOf(ctx: Ctx): Actor {
  if (!ctx.actor) throw unauthorizedError();
  return ctx.actor;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

// Small path router: '/api/users/:id' style patterns, exact segment matching.
export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: split(pattern), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  put(p: string, h: Handler) { return this.on('PUT', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method_not_allowed' | null {
    const segs = split(path);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i]!;
        const s = segs[i]!;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}
