import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { hashPassword } from '../src/crypto';
import type { Env } from '../src/db';
import { handle } from '../src/index';
import { createTestDb } from './helpers/d1';

let env: Env;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.origin) headers.origin = opts.origin;
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function addUser(username: string, password: string, role: 'admin' | 'member' = 'member', mustChange = 0) {
  await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)')
    .bind(username, username, await hashPassword(password), role, mustChange)
    .run();
}

async function login(username: string, password: string) {
  const r = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
}

const cats = async (token: string) => (await call('GET', '/api/time-categories', { token })).body.categories as { id: number; nameTh: string }[];

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: 'https://balance-our-day.pages.dev' };
  await addUser('kim', 'kimpass123', 'admin');
  await addUser('mega', 'megapass123', 'admin');
});

describe('auth', () => {
  test('login works with the right password and fails otherwise', async () => {
    const bad = await call('POST', '/api/auth/login', { body: { username: 'kim', password: 'nope' } });
    assert.equal(bad.status, 401);
    const unknown = await call('POST', '/api/auth/login', { body: { username: 'ghost', password: 'nope' } });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, bad.body.error.message); // no user enumeration
    const token = await login('KIM', 'kimpass123'); // usernames are case-insensitive
    const me = await call('GET', '/api/me', { token });
    assert.equal(me.body.user.username, 'kim');
    assert.equal(me.body.privacy.answers, 'hide');
  });

  test('account locks after 10 failed attempts', async () => {
    for (let i = 0; i < 10; i++) await call('POST', '/api/auth/login', { body: { username: 'kim', password: 'wrong' } });
    const r = await call('POST', '/api/auth/login', { body: { username: 'kim', password: 'kimpass123' } });
    assert.equal(r.status, 429);
  });

  test('first login must change password before using the app', async () => {
    await addUser('ploy', 'Password!', 'member', 1);
    const token = await login('ploy', 'Password!');
    assert.equal((await call('GET', '/api/now', { token })).status, 403);
    const weak = await call('POST', '/api/me/password', { token, body: { currentPassword: 'Password!', newPassword: 'short' } });
    assert.equal(weak.status, 400);
    assert.deepEqual(weak.body.error.details.problems, ['min_length_8', 'letters_and_digits']);
    const same = await call('POST', '/api/me/password', { token, body: { currentPassword: 'Password!', newPassword: 'Password!' } });
    assert.ok(same.body.error.details.problems.includes('not_default'));
    const ok = await call('POST', '/api/me/password', { token, body: { currentPassword: 'Password!', newPassword: 'newpass2026' } });
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', '/api/now', { token })).status, 200);
  });

  test('logout revokes the session; missing token is 401', async () => {
    const token = await login('kim', 'kimpass123');
    await call('POST', '/api/auth/logout', { token });
    assert.equal((await call('GET', '/api/me', { token })).status, 401);
    assert.equal((await call('GET', '/api/me')).status, 401);
  });

  test('personal API tokens work as bearer tokens and can be revoked', async () => {
    const session = await login('kim', 'kimpass123');
    const t = await call('POST', '/api/me/tokens', { token: session, body: { name: 'Claude ของ kim' } });
    assert.equal(t.status, 201);
    assert.match(t.body.token, /^wlb_/);
    assert.equal((await call('GET', '/api/me', { token: t.body.token })).status, 200);
    const list = await call('GET', '/api/me/tokens', { token: session });
    assert.equal(list.body.tokens[0].hint, t.body.token.slice(-4));
    await call('DELETE', `/api/me/tokens/${t.body.id}`, { token: session });
    assert.equal((await call('GET', '/api/me', { token: t.body.token })).status, 401);
  });
});

describe('schedule', () => {
  test('write a range, overwrite needs confirmation, undo restores, clear empties', async () => {
    const token = await login('kim', 'kimpass123');
    const [rest, work] = await cats(token);
    // Mon–Fri 10–18 work (empty before → no confirmation needed)
    const w1 = await call('PUT', '/api/schedules/1/range', { token, body: { days: [0, 1, 2, 3, 4], from: 10, to: 18, categoryIds: [work!.id], description: 'งานประจำ' } });
    assert.equal(w1.status, 200, JSON.stringify(w1.body));
    assert.equal(w1.body.fillCount, 40);
    assert.equal(w1.body.summary.plannedHours, 40);

    // preview + write that overlaps Wednesday 16–20
    const body = { days: [2], from: 16, to: 20, categoryIds: [rest!.id], description: 'พัก' };
    const pv = await call('POST', '/api/schedules/1/preview', { token, body });
    assert.deepEqual([pv.body.overwriteCount, pv.body.fillCount], [2, 2]);
    const blocked = await call('PUT', '/api/schedules/1/range', { token, body });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'overwrite_needs_confirm');
    const done = await call('PUT', '/api/schedules/1/range', { token, body: { ...body, confirmOverwrite: true } });
    assert.equal(done.status, 200);
    assert.equal(done.body.week[2 * 24 + 17].description, 'พัก');

    // undo
    const undone = await call('PUT', '/api/schedules/1/cells', { token, body: { cells: done.body.undo } });
    assert.equal(undone.body.week[2 * 24 + 17].description, 'งานประจำ');
    assert.equal(undone.body.week[2 * 24 + 19], null);

    // clear Wednesday's work block only
    const cleared = await call('POST', '/api/schedules/1/clear', { token, body: { days: [2], from: 10, to: 18 } });
    assert.equal(cleared.body.clearedCount, 8);
    assert.equal(cleared.body.summary.plannedHours, 32);
  });

  test('multi-category slot is split in the summary', async () => {
    const token = await login('kim', 'kimpass123');
    const [rest, , side] = await cats(token);
    const r = await call('PUT', '/api/schedules/1/range', { token, body: { days: [0, 1, 2, 3, 4, 5, 6], from: 20, to: 24, categoryIds: [side!.id, rest!.id], description: 'สตีมเกม' } });
    const by = Object.fromEntries(r.body.summary.categories.map((c: { categoryId: number; hours: number }) => [c.categoryId, c.hours]));
    assert.equal(by[rest!.id], 14);
    assert.equal(by[side!.id], 14);
    assert.deepEqual(r.body.week[20].categoryIds, [rest!.id, side!.id].sort((a, b) => a - b));
  });

  test('targets must be all 0 or add up to 100', async () => {
    const token = await login('kim', 'kimpass123');
    const c = await cats(token);
    const bad = await call('PUT', '/api/schedules/1/targets', { token, body: { targets: { [c[0]!.id]: 50 } } });
    assert.equal(bad.status, 400);
    const ok = await call('PUT', '/api/schedules/1/targets', { token, body: { targets: { [c[0]!.id]: 40, [c[1]!.id]: 60 } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.summary.targetsSet, true);
  });

  test('members cannot edit someone else; admins can', async () => {
    await addUser('ploy', 'ploypass123');
    const ploy = await login('ploy', 'ploypass123');
    const [rest] = await cats(ploy);
    const body = { days: [0], from: 0, to: 1, categoryIds: [rest!.id], description: '' };
    assert.equal((await call('PUT', '/api/schedules/1/range', { token: ploy, body })).status, 403);
    const kim = await login('kim', 'kimpass123');
    assert.equal((await call('PUT', '/api/schedules/3/range', { token: kim, body })).status, 200);
  });

  test('unknown categories and bad ranges are rejected', async () => {
    const token = await login('kim', 'kimpass123');
    assert.equal((await call('PUT', '/api/schedules/1/range', { token, body: { days: [0], from: 0, to: 1, categoryIds: [999] } })).status, 400);
    assert.equal((await call('PUT', '/api/schedules/1/range', { token, body: { days: [0], from: 5, to: 5, categoryIds: [1] } })).status, 400);
    assert.equal((await call('PUT', '/api/schedules/1/range', { token, body: { days: [7], from: 0, to: 1, categoryIds: [1] } })).status, 400);
  });
});

describe('privacy', () => {
  async function setup() {
    const kim = await login('kim', 'kimpass123');
    const mega = await login('mega', 'megapass123');
    const [rest] = await cats(kim);
    await call('PUT', '/api/schedules/2/range', { token: mega, body: { days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24, categoryIds: [rest!.id], description: 'บ เถื่อน' } });
    return { kim, mega };
  }
  const base = { privateMode: false, schedule: 'full', nowStatus: 'full', summary: 'show', courses: 'show', answers: 'hide' };

  test('"cat" hides descriptions but keeps categories; owner still sees everything', async () => {
    const { kim, mega } = await setup();
    await call('PUT', '/api/me/privacy', { token: mega, body: { ...base, schedule: 'cat', nowStatus: 'cat' } });
    const seenByKim = await call('GET', '/api/schedules/2', { token: kim });
    assert.equal(seenByKim.body.week[0].description, '');
    assert.equal(seenByKim.body.week[0].categoryIds.length, 1);
    assert.equal(seenByKim.body.editable, true); // kim is admin
    const own = await call('GET', '/api/schedules/2', { token: mega });
    assert.equal(own.body.week[0].description, 'บ เถื่อน');
    const now = await call('GET', '/api/now', { token: kim });
    assert.equal(now.body.others[0].now.current.slot.description, '');
  });

  test('private mode hides everything from others — admins included', async () => {
    const { kim, mega } = await setup();
    await call('PUT', '/api/me/privacy', { token: mega, body: { ...base, privateMode: true } });
    const s = await call('GET', '/api/schedules/2', { token: kim });
    assert.equal(s.body.week, null);
    assert.equal(s.body.summary, null);
    const members = await call('GET', '/api/users', { token: kim });
    const megaCard = members.body.members.find((m: { user: { username: string } }) => m.user.username === 'mega');
    assert.equal(megaCard.privateMode, true);
    assert.equal(megaCard.now, null);
    assert.equal(megaCard.summary, null);
  });
});

describe('admin', () => {
  test('create user, reset password, cannot remove the last admin', async () => {
    const kim = await login('kim', 'kimpass123');
    const created = await call('POST', '/api/admin/users', { token: kim, body: { username: 'Ploy', password: 'temp-pass-1', role: 'member' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.username, 'ploy');
    assert.equal((await call('POST', '/api/admin/users', { token: kim, body: { username: 'ploy', password: 'temp-pass-1' } })).status, 409);
    const ploy = await login('ploy', 'temp-pass-1');
    assert.equal((await call('GET', '/api/me', { token: ploy })).body.user.mustChangePassword, true);
    assert.equal((await call('GET', '/api/admin/users', { token: ploy })).status, 403);

    await call('PATCH', '/api/admin/users/2', { token: kim, body: { role: 'member' } });
    const last = await call('PATCH', '/api/admin/users/1', { token: kim, body: { role: 'member' } });
    assert.equal(last.status, 409);
    assert.equal((await call('PATCH', '/api/admin/users/1', { token: kim, body: { disabled: true } })).status, 400);
  });

  test('a category in use cannot be deleted', async () => {
    const kim = await login('kim', 'kimpass123');
    const [rest] = await cats(kim);
    await call('PUT', '/api/schedules/1/range', { token: kim, body: { days: [0], from: 0, to: 1, categoryIds: [rest!.id] } });
    const del = await call('DELETE', `/api/time-categories/${rest!.id}`, { token: kim });
    assert.equal(del.status, 409);
    const add = await call('POST', '/api/time-categories', { token: kim, body: { nameTh: 'อ่านหนังสือ', color: '#aabbcc' } });
    assert.equal(add.status, 201);
    assert.equal((await call('DELETE', `/api/time-categories/${add.body.id}`, { token: kim })).status, 200);
    assert.equal((await call('GET', '/api/course-categories', { token: kim })).body.categories.length, 13);
  });
});

describe('http', () => {
  test('CORS allows the Pages site and its preview subdomains only', async () => {
    const ok = await call('GET', '/api/health', { origin: 'https://balance-our-day.pages.dev' });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://balance-our-day.pages.dev');
    const preview = await call('GET', '/api/health', { origin: 'https://abc123.balance-our-day.pages.dev' });
    assert.equal(preview.headers.get('access-control-allow-origin'), 'https://abc123.balance-our-day.pages.dev');
    const evil = await call('GET', '/api/health', { origin: 'https://evil.example' });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  test('unknown route 404, wrong method 405', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('DELETE', '/api/health')).status, 405);
  });
});
