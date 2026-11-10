// Routines over HTTP on SQLite: import (items + plans), totals, visibility, editing, linking plans to days, MCP tools.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { EXAMPLE_ROUTINES } from '../src/domain/routine-guide';
import type { Env } from '../src/index';
import { handle } from '../src/index';
import { hashPassword } from '../src/services/password-service';
import { createTestDb } from './helpers/d1';

let env: Env;
let kim: string, ploy: string;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text };
}

async function user(username: string, role: 'admin' | 'member' = 'member') {
  await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .bind(username, username, await hashPassword('pass-1234'), role).run();
  return (await call('POST', '/api/auth/login', { body: { username, password: 'pass-1234' } })).body.token as string;
}

const example = () => JSON.parse(JSON.stringify(EXAMPLE_ROUTINES));
async function importExample(token: string, over: (x: any) => void = () => {}) {
  const body = example();
  over(body);
  const r = await call('POST', '/api/routines/import', { token, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { items: { id: number; title: string }[]; plans: { id: number; title: string; kind: string }[]; status: string };
}

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: '', WEB_URL: 'https://web.test' };
  kim = await user('kim', 'admin');
  ploy = await user('ploy');
});

describe('import format', () => {
  test('the guide is public and its example validates', async () => {
    const g = await call('GET', '/api/routines/guide.md');
    assert.equal(g.status, 200);
    assert.match(g.body, /routine import guide/);
    const v = await call('POST', '/api/routines/validate', { token: ploy, body: example() });
    assert.deepEqual(v.body.errors, []);
  });

  test('errors point at the field: wrong item kind, unknown item, bad section, bad numbers', async () => {
    const body = example();
    body.plans[0].entries.push({ section: 'main', item: 'Greek yogurt with banana' }); // meal in a workout
    body.plans[0].entries.push({ section: 'main', item: 'Burpee' }); // does not exist
    body.plans[1].entries[0].section = 'brunch';
    body.items[3].calories = -5;
    body.items[0].muscles = ['wings'];
    const v = await call('POST', '/api/routines/validate', { token: ploy, body });
    const paths = v.body.errors.map((e: { path: string }) => e.path);
    for (const p of ['plans[0].entries[4].item', 'plans[0].entries[5].item', 'plans[1].entries[0].section', 'items[3].calories', 'items[0].muscles[0]']) assert.ok(paths.includes(p), p);
    const r = await call('POST', '/api/routines/import', { token: ploy, body });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'invalid_routine');
  });

  test('plans can reuse library items by title; mismatched calories are a warning', async () => {
    await importExample(ploy);
    const v = await call('POST', '/api/routines/validate', { token: kim, body: {
      items: [{ kind: 'meal', title: 'Boiled egg', calories: 300, protein: 6, carbs: 1, fat: 5 }],
      plans: [{ kind: 'meal', title: 'Light day', entries: [{ section: 'breakfast', item: 'boiled egg', servings: 2 }, { section: 'lunch', item: 'grilled chicken breast with rice' }] }],
    } });
    assert.deepEqual(v.body.errors, []);
    assert.ok(v.body.warnings.some((w: { path: string }) => w.path === 'items[0].calories'));
  });
});

describe('plans', () => {
  test('meal plan totals and workout minutes', async () => {
    const r = await importExample(ploy);
    const meal = await call('GET', `/api/routines/plans/${r.plans[1]!.id}`, { token: kim });
    // 250 + 520 + 520 + 125 = 1415 kcal · protein 18+45+45+9 = 117
    assert.equal(meal.body.plan.totals.calories, 1415);
    assert.equal(meal.body.plan.totals.protein, 117);
    assert.equal(meal.body.plan.totals.bySection.snack, 125);
    assert.equal(meal.body.entries.length, 4);
    const wo = await call('GET', `/api/routines/plans/${r.plans[0]!.id}`, { token: kim });
    assert.ok(wo.body.plan.minutes >= 5);
    assert.deepEqual(wo.body.plan.muscles.sort(), ['arms', 'chest', 'core', 'glutes', 'legs']);
  });

  test('editing a plan replaces its entries; only the creator or an admin may', async () => {
    const r = await importExample(ploy);
    const id = r.plans[0]!.id;
    const ex = (await call('GET', `/api/routines/plans/${id}/export`, { token: ploy })).body;
    assert.equal(ex.items.length, 3);
    const plan = ex.plans[0];
    plan.entries = plan.entries.slice(1);
    plan.title = 'Full body A (no warm-up)';
    const kimUser = await user('nok');
    assert.equal((await call('PUT', `/api/routines/plans/${id}`, { token: kimUser, body: plan })).status, 403);
    const up = await call('PUT', `/api/routines/plans/${id}`, { token: ploy, body: plan });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const g = await call('GET', `/api/routines/plans/${id}`, { token: ploy });
    assert.equal(g.body.plan.title, 'Full body A (no warm-up)');
    assert.equal(g.body.entries.length, 3);
  });

  test('an item used in a plan cannot be deleted; a plan can', async () => {
    const r = await importExample(ploy);
    const pushup = r.items.find((i) => i.title === 'Push-up')!.id;
    assert.equal((await call('DELETE', `/api/routines/items/${pushup}`, { token: ploy })).body.error.code, 'item_in_use');
    assert.equal((await call('DELETE', `/api/routines/plans/${r.plans[0]!.id}`, { token: ploy })).status, 200);
    assert.equal((await call('DELETE', `/api/routines/items/${pushup}`, { token: ploy })).status, 200);
  });

  test('item update keeps kind and status', async () => {
    const r = await importExample(ploy);
    const id = r.items.find((i) => i.title === 'Plank')!.id;
    const ex = (await call('GET', `/api/routines/items/${id}/export`, { token: ploy })).body;
    ex.seconds = 45;
    ex.kind = 'meal'; // ignored: kind cannot change
    const up = await call('PUT', `/api/routines/items/${id}`, { token: ploy, body: ex });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const g = await call('GET', `/api/routines/items/${id}`, { token: ploy });
    assert.equal(g.body.item.kind, 'exercise');
    assert.equal(g.body.item.data.seconds, 45);
    assert.equal(g.body.usedIn.length, 1);
  });
});

describe('visibility', () => {
  test('private and draft routines stay with the creator', async () => {
    await importExample(ploy, (b) => { b.plans[0].visibility = 'private'; });
    const t = await call('POST', '/api/me/tokens', { token: ploy, body: { name: 'script' } });
    const d = await call('POST', '/api/routines/import', { token: t.body.token, body: { items: [{ kind: 'meal', title: 'Som tam', calories: 120 }] } });
    assert.equal(d.body.status, 'draft');
    const mine = await call('GET', '/api/routines', { token: ploy });
    const other = await call('GET', '/api/routines', { token: kim });
    assert.equal(mine.body.plans.length, 2);
    assert.equal(other.body.plans.length, 1);
    assert.equal(mine.body.items.length, 6);
    assert.equal(other.body.items.length, 5);
  });
});

describe('linking plans to my week', () => {
  test('days with optional hour; shows on the week, the plan and the home page', async () => {
    const r = await importExample(ploy);
    const wo = r.plans[0]!.id, meal = r.plans[1]!.id;
    // Tuesday 20:00 workout, Mon–Fri meal plan for the whole day
    await call('PUT', `/api/routines/plans/${wo}/days`, { token: kim, body: { days: [{ weekday: 1, hour: 20 }, { weekday: 3, hour: 20 }] } });
    await call('PUT', `/api/routines/plans/${meal}/days`, { token: kim, body: { days: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, hour: null })) } });
    const week = await call('GET', '/api/routines/week', { token: kim });
    assert.equal(week.body.links.length, 7);
    assert.equal(week.body.links.find((l: { hour: number | null }) => l.hour === 20).plan.title, 'Beginner full body A');
    const plan = await call('GET', `/api/routines/plans/${wo}`, { token: kim });
    assert.deepEqual(plan.body.myDays, [{ weekday: 1, hour: 20 }, { weekday: 3, hour: 20 }]);
    // other users are not affected
    assert.equal((await call('GET', '/api/routines/week', { token: ploy })).body.links.length, 0);
    // replacing removes old days
    await call('PUT', `/api/routines/plans/${wo}/days`, { token: kim, body: { days: [] } });
    assert.equal((await call('GET', '/api/routines/week', { token: kim })).body.links.length, 5);
    assert.equal((await call('PUT', `/api/routines/plans/${wo}/days`, { token: kim, body: { days: [{ weekday: 9, hour: 0 }] } })).status, 400);
    const now = await call('GET', '/api/now', { token: kim });
    assert.ok(Array.isArray(now.body.routinesToday));
  });
});

describe('recipes', () => {
  test('meal recipe fields round-trip and are validated', async () => {
    const meal = { kind: 'meal', title: 'Air-fryer chicken thigh', mealTypes: ['lunch'], calories: 300, protein: 30, carbs: 2, fat: 19,
      ingredients: ['150 g chicken thigh', '1 tbsp soy sauce'], steps: '1. Marinate\n2. Air fry 180°C 18 min',
      prepMinutes: 35, cookMinutes: 18, makes: 2, tools: ['air fryer'], tips: 'Do not overcook.' };
    const r = await call('POST', '/api/routines/import', { token: kim, body: meal });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.items[0].id;
    const got = await call('GET', `/api/routines/items/${id}`, { token: kim });
    assert.equal(got.body.item.data.cookMinutes, 18);
    assert.deepEqual(got.body.item.data.tools, ['air fryer']);
    const ex = await call('GET', `/api/routines/items/${id}/export`, { token: kim });
    const back = ex.body.items?.[0] ?? ex.body;
    assert.equal(back.prepMinutes, 35);
    assert.equal(back.makes, 2);
    assert.equal(back.tips, 'Do not overcook.');
    const bad = await call('POST', '/api/routines/validate', { token: kim, body: { ...meal, cookMinutes: 9999 } });
    assert.ok(bad.body.errors.some((e: { path: string }) => e.path === 'cookMinutes'));
  });
});
