import type { JsonRpcRequest } from '../../usecases/mcp';
import { json } from '../http';
import type { Router } from '../router';

/** MCP Streamable HTTP endpoint. POST only; we reply with plain JSON (no SSE stream needed). */
export function mcpController(r: Router) {
  r.post('/mcp', async (ctx) => {
    if (!ctx.actor) {
      const hasToken = !!ctx.req.headers.get('authorization');
      const res = json({ error: hasToken ? 'invalid_token' : 'unauthorized', error_description: 'Connect with OAuth to use this server' }, 401);
      res.headers.set('www-authenticate',
        `Bearer resource_metadata="${ctx.url.origin}/.well-known/oauth-protected-resource"${hasToken ? ', error="invalid_token"' : ''}`);
      return res;
    }
    let body: unknown;
    try { body = await ctx.req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
    const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[];
    const out = [];
    for (const m of messages) {
      const res = await ctx.uc.mcp.execute(ctx.actor, m);
      if (res) out.push(res);
    }
    if (!out.length) return new Response(null, { status: 202 });
    return json(Array.isArray(body) ? out : out[0]);
  });

  const noStream = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
  r.get('/mcp', noStream);
  r.delete('/mcp', noStream);
}
