// OAuth 2.1 + MCP end to end: discovery → register → authorize → consent → token → tools → refresh → revoke.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { pkceChallenge } from '../src/domain/oauth';
import { EXAMPLE_COURSE } from '../src/domain/import-guide';
import type { Env } from '../src/index';
import { handle } from '../src/index';
import { hashPassword } from '../src/services/password-service';
import { createTestDb } from './helpers/d1';

const API = 'https://api.test';
const WEB = 'https://web.test';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(20) + '-verifier_' + 'x'.repeat(20);
let env: Env;
let kim: string, ploy: string;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(opts.form).toString(); }
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await handle(new Request(API + path, { method, headers, body, redirect: 'manual' }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text };
}

async function user(username: string, role: 'admin' | 'member' = 'member') {
  await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .bind(username, username, await hashPassword('pass-1234'), role).run();
  return (await call('POST', '/api/auth/login', { body: { username, password: 'pass-1234' } })).body.token as string;
}

async function register() {
  const r = await call('POST', '/oauth/register', { body: { client_name: 'Claude', redirect_uris: [REDIRECT] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.client_id as string;
}

async function authParams(clientId: string) {
  return { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: await pkceChallenge(VERIFIER), code_challenge_method: 'S256', state: 'st-1', scope: 'courses' };
}

/** Full browser part of the flow: authorize → consent page → approve. Returns the code. */
async function getCode(session: string, clientId: string, autoPublish = false) {
  const p = await authParams(clientId);
  const a = await call('GET', `/oauth/authorize?${new URLSearchParams(p)}`);
  assert.equal(a.status, 302);
  const consent = new URL(a.headers.get('location')!);
  assert.equal(consent.origin + consent.pathname, `${WEB}/oauth/consent`);
  const params = Object.fromEntries(consent.searchParams);
  const info = await call('GET', `/api/oauth/consent?${consent.searchParams}`, { token: session });
  assert.equal(info.body.client.name, 'Claude');
  const d = await call('POST', '/api/oauth/consent', { token: session, body: { ...params, approve: true, autoPublish } });
  const back = new URL(d.body.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), 'st-1');
  return back.searchParams.get('code')!;
}

async function connect(session: string, autoPublish = false) {
  const clientId = await register();
  const code = await getCode(session, clientId, autoPublish);
  const t = await call('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT } });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return { clientId, access: t.body.access_token as string, refresh: t.body.refresh_token as string };
}

let rpcId = 0;
async function rpc(token: string, method: string, params?: unknown) {
  const r = await call('POST', '/mcp', { token, body: { jsonrpc: '2.0', id: ++rpcId, method, params } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function tool(token: string, name: string, args: unknown = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const t = r.result.content[0].text as string;
  let data: unknown = t;
  try { data = JSON.parse(t); } catch { /* markdown */ }
  return { isError: r.result.isError as boolean, data: data as any };
}

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: WEB, WEB_URL: WEB };
  kim = await user('kim', 'admin');
  ploy = await user('ploy');
});

describe('discovery', () => {
  test('/mcp without a token points the client at the OAuth metadata', async () => {
    const r = await call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate')!, /resource_metadata="https:\/\/api\.test\/\.well-known\/oauth-protected-resource"/);
    const pr = await call('GET', '/.well-known/oauth-protected-resource');
    assert.deepEqual(pr.body.authorization_servers, [API]);
    assert.equal(pr.body.resource, `${API}/mcp`);
    const as = await call('GET', '/.well-known/oauth-authorization-server');
    assert.equal(as.body.registration_endpoint, `${API}/oauth/register`);
    assert.deepEqual(as.body.code_challenge_methods_supported, ['S256']);
    const pre = await call('OPTIONS', '/oauth/token', { headers: { origin: 'https://claude.ai' } });
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  });

  test('registration only accepts https or localhost redirect URIs', async () => {
    const bad = await call('POST', '/oauth/register', { body: { client_name: 'x', redirect_uris: ['http://evil.example/cb'] } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_redirect_uri');
    const local = await call('POST', '/oauth/register', { form: { client_name: 'cli', redirect_uris: 'x' } });
    assert.equal(local.status, 400);
    const ok = await call('POST', '/oauth/register', { body: { redirect_uris: ['http://localhost:33418/callback'] } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.token_endpoint_auth_method, 'none');
  });
});

describe('authorization', () => {
  test('unknown client or redirect shows an error page, never redirects', async () => {
    const clientId = await register();
    const p = await authParams(clientId);
    const unknown = await call('GET', `/oauth/authorize?${new URLSearchParams({ ...p, client_id: 'nope' })}`);
    assert.equal(unknown.status, 400);
    assert.match(unknown.body, /Unknown client_id/);
    const wrong = await call('GET', `/oauth/authorize?${new URLSearchParams({ ...p, redirect_uri: 'https://evil.example/cb' })}`);
    assert.equal(wrong.status, 400);
    const noPkce = await call('GET', `/oauth/authorize?${new URLSearchParams({ ...p, code_challenge: '' })}`);
    assert.equal(noPkce.status, 302);
    assert.match(noPkce.headers.get('location')!, /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request&state=st-1$/);
  });

  test('deny returns access_denied; API tokens cannot approve', async () => {
    const clientId = await register();
    const p = await authParams(clientId);
    const d = await call('POST', '/api/oauth/consent', { token: kim, body: { ...p, approve: false } });
    assert.match(d.body.redirect, /error=access_denied/);
    const api = (await call('POST', '/api/me/tokens', { token: kim, body: { name: 'script' } })).body.token;
    assert.equal((await call('POST', '/api/oauth/consent', { token: api, body: { ...p, approve: true } })).status, 403);
    assert.equal((await call('POST', '/api/oauth/consent', { body: { ...p, approve: true } })).status, 401);
  });

  test('codes need the right PKCE verifier, client and redirect, and work once', async () => {
    const clientId = await register();
    const code = await getCode(kim, clientId);
    const base = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT };
    const bad = await call('POST', '/oauth/token', { form: { ...base, code_verifier: 'w'.repeat(50) } });
    assert.equal(bad.body.error, 'invalid_grant');
    // a failed attempt burns the code too (it was taken)
    const again = await call('POST', '/oauth/token', { form: { ...base, code_verifier: VERIFIER } });
    assert.equal(again.body.error, 'invalid_grant');
    const code2 = await getCode(kim, clientId);
    const ok = await call('POST', '/oauth/token', { form: { ...base, code: code2, code_verifier: VERIFIER } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.token_type, 'Bearer');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const reuse = await call('POST', '/oauth/token', { form: { ...base, code: code2, code_verifier: VERIFIER } });
    assert.equal(reuse.body.error, 'invalid_grant');
  });
});

describe('MCP tools', () => {
  test('initialize, list tools, notifications', async () => {
    const { access } = await connect(ploy);
    const init = await rpc(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /get_import_guide/);
    const n = await call('POST', '/mcp', { token: access, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(n.status, 202);
    const tools = (await rpc(access, 'tools/list')).result.tools.map((t: { name: string }) => t.name);
    assert.deepEqual(tools, ['get_import_guide', 'list_course_categories', 'list_packs', 'list_my_courses', 'get_course', 'validate_course', 'create_course',
      'get_routine_guide', 'list_routines', 'get_routine_plan', 'validate_routines', 'create_routines', 'update_routine_item', 'update_routine_plan', 'get_my_body_stats', 'update_course']);
    assert.equal((await rpc(access, 'nope')).error.code, -32601);
    assert.equal((await call('GET', '/mcp', { token: access })).status, 405);
  });

  test('guide → validate → create a draft → others cannot see it until published', async () => {
    const { access } = await connect(ploy);
    const g = await tool(access, 'get_import_guide');
    assert.match(g.data, /course import guide/);
    const bad = await tool(access, 'validate_course', { course: { title: 'x', lessons: [] } });
    assert.equal(bad.data.ok, false);
    const created = await tool(access, 'create_course', { course: EXAMPLE_COURSE });
    assert.equal(created.isError, false);
    assert.equal(created.data.status, 'draft');
    assert.equal(created.data.url, `${WEB}/courses/${created.data.id}`);
    assert.equal((await call('GET', '/api/courses', { token: kim })).body.packs.flatMap((p: { courses: unknown[] }) => p.courses).length, 0);
    const mine = await tool(access, 'list_my_courses');
    assert.equal(mine.data[0].status, 'draft');
    const packs = await tool(access, 'list_packs');
    assert.equal(packs.data[0].title, 'English');
    // invalid course → error result with details Claude can fix
    const err = await tool(access, 'create_course', { course: { ...EXAMPLE_COURSE, category: 'Knitting' } });
    assert.equal(err.isError, true);
    assert.equal(err.data.error, 'invalid_course');
    assert.equal(err.data.details.errors[0].path, 'category');
  });

  test('auto-publish when the user allowed it on the consent page', async () => {
    const { access } = await connect(ploy, true);
    const created = await tool(access, 'create_course', { course: EXAMPLE_COURSE });
    assert.equal(created.data.status, 'published');
    assert.equal((await call('GET', '/api/courses', { token: kim })).body.packs[0].courses.length, 1);
  });

  test('get_course → update_course keeps ids; only own courses can be updated', async () => {
    const { access } = await connect(ploy);
    const { data: c } = await tool(access, 'create_course', { course: EXAMPLE_COURSE });
    const { data: json } = await tool(access, 'get_course', { course_id: c.id });
    json.lessons[0].title = 'Hello again';
    const up = await tool(access, 'update_course', { course_id: c.id, course: json });
    assert.equal(up.isError, false);
    const after = (await tool(access, 'get_course', { course_id: c.id })).data;
    assert.equal(after.lessons[0].title, 'Hello again');
    assert.equal(after.lessons[0].id, json.lessons[0].id);
    // kim (admin) connects; she may not update ploy's course through MCP
    const k = await connect(kim);
    const denied = await tool(k.access, 'update_course', { course_id: c.id, course: json });
    assert.equal(denied.isError, true);
    assert.equal(denied.data.error, 'forbidden');
  });
});

describe('tokens', () => {
  test('refresh rotates tokens; revoking in settings ends the connection', async () => {
    const { clientId, access, refresh } = await connect(ploy);
    const r = await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId } });
    assert.equal(r.status, 200);
    assert.notEqual(r.body.access_token, access);
    assert.equal((await call('POST', '/mcp', { token: access, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status, 401, 'old access token is gone');
    assert.equal((await rpc(r.body.access_token, 'ping')).result && true, true);
    const old = await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: refresh } });
    assert.equal(old.body.error, 'invalid_grant', 'old refresh token stops working');

    const list = (await call('GET', '/api/me/tokens', { token: ploy })).body.tokens;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Claude (MCP)');
    await call('DELETE', `/api/me/tokens/${list[0].id}`, { token: ploy });
    const dead = await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: r.body.refresh_token } });
    assert.equal(dead.body.error, 'invalid_grant');
  });
});

describe('MCP routines', () => {
  test('guide → create routines as drafts → get plan → update own plan', async () => {
    const { EXAMPLE_ROUTINES } = await import('../src/domain/routine-guide');
    const { access } = await connect(ploy);
    assert.match((await tool(access, 'get_routine_guide')).data, /routine import guide/);
    const v = await tool(access, 'validate_routines', { routines: { plans: [{ kind: 'meal', title: 'x', entries: [{ section: 'lunch', item: 'nope' }] }] } });
    assert.equal(v.data.ok, false);
    const c = await tool(access, 'create_routines', { routines: EXAMPLE_ROUTINES });
    assert.equal(c.isError, false);
    assert.equal(c.data.status, 'draft');
    assert.equal(c.data.plans.length, 2);
    assert.match(c.data.plans[0].url, /^https:\/\/web\.test\/routines\/plans\/\d+$/);
    const list = await tool(access, 'list_routines');
    assert.equal(list.data.items.length, 5);
    const plan = await tool(access, 'get_routine_plan', { plan_id: c.data.plans[1].id });
    const p = plan.data.plans[0];
    p.title = 'Changed by AI';
    assert.equal((await tool(access, 'update_routine_plan', { plan_id: p.id, plan: p })).isError, false);
    const k = await connect(kim);
    assert.equal((await tool(k.access, 'update_routine_plan', { plan_id: p.id, plan: p })).data.error, 'forbidden');
  });
});
