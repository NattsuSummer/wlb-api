// Body stats over HTTP on SQLite: private check-ins, upsert by date, summary, goal, home reminder.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { bangkokDate, bodySummary } from '../src/domain/body';
import type { Env } from '../src/index';
import { handle } from '../src/index';
import { hashPassword } from '../src/services/password-service';
import { createTestDb } from './helpers/d1';

let env: Env;
let kim: string, ploy: string;
const today = bangkokDate(new Date());
const daysAgo = (n: number) => bangkokDate(new Date(Date.now() - n * 86_400_000));

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text };
}
async function user(username: string) {
  await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .bind(username, username, await hashPassword('pass-1234'), 'member').run();
  return (await call('POST', '/api/auth/login', { body: { username, password: 'pass-1234' } })).body.token as string;
}

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: '', WEB_URL: 'https://web.test' };
  kim = await user('kim');
  ploy = await user('ploy');
});

describe('body stats', () => {
  test('needs login; empty state is due', async () => {
    assert.equal((await call('GET', '/api/body')).status, 401);
    const r = await call('GET', '/api/body', { token: kim });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.entries, []);
    assert.equal(r.body.summary.due, true);
    assert.equal(r.body.today, today);
  });

  test('save, upsert same date, summary and BMI', async () => {
    let r = await call('PUT', `/api/body/entries/${daysAgo(14)}`, { token: kim, body: { weightKg: 100, heightCm: 175, waistCm: 104 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await call('PUT', `/api/body/entries/${daysAgo(7)}`, { token: kim, body: { weightKg: 99.2 } });
    r = await call('PUT', `/api/body/entries/${daysAgo(7)}`, { token: kim, body: { weightKg: 99.0, note: 'แก้' } });
    r = await call('PUT', `/api/body/entries/${today}`, { token: kim, body: { weightKg: '98.46', bodyFat: 30 } });
    const s = r.body.summary;
    assert.equal(r.body.entries.length, 3);
    assert.equal(r.body.entries[1].weightKg, 99);
    assert.equal(r.body.entries[1].note, 'แก้');
    assert.equal(s.latest.weightKg, 98.5);
    assert.equal(s.heightCm, 175);
    assert.equal(s.bmi, 32.2);
    assert.equal(s.changeKg, -1.5);
    assert.equal(s.lastWeekChangeKg, -0.5);
    assert.equal(s.avgPerWeekKg, -0.7); // -1.5 kg over 2 weeks, rounded
    assert.equal(s.due, false);
    assert.equal(s.daysSinceLast, 0);
  });

  test('validation: required weight, ranges, dates', async () => {
    const bad = async (date: string, body: unknown) => (await call('PUT', `/api/body/entries/${date}`, { token: kim, body })).status;
    assert.equal(await bad(today, {}), 400);
    assert.equal(await bad(today, { weightKg: 5 }), 400);
    assert.equal(await bad(today, { weightKg: 'x' }), 400);
    assert.equal(await bad(today, { weightKg: 90, heightCm: 400 }), 400);
    assert.equal(await bad(today, { weightKg: 90, bodyFat: 90 }), 400);
    assert.equal(await bad('2026-02-30', { weightKg: 90 }), 400);
    assert.equal(await bad('not-a-date', { weightKg: 90 }), 400);
    assert.equal(await bad('2999-01-01', { weightKg: 90 }), 400);
  });

  test('private per user; delete; goal', async () => {
    await call('PUT', `/api/body/entries/${today}`, { token: kim, body: { weightKg: 100 } });
    assert.deepEqual((await call('GET', '/api/body', { token: ploy })).body.entries, []);
    assert.equal((await call('DELETE', `/api/body/entries/${today}`, { token: ploy })).status, 404);
    let r = await call('PUT', '/api/body/goal', { token: kim, body: { targetWeightKg: 85 } });
    assert.equal(r.body.goal.targetWeightKg, 85);
    assert.equal(r.body.summary.toGoalKg, 15);
    r = await call('PUT', '/api/body/goal', { token: kim, body: { targetWeightKg: null } });
    assert.equal(r.body.goal.targetWeightKg, null);
    r = await call('DELETE', `/api/body/entries/${today}`, { token: kim });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.entries, []);
  });

  test('home reminder after 7 days', async () => {
    await call('PUT', `/api/body/entries/${daysAgo(8)}`, { token: kim, body: { weightKg: 100 } });
    let n = await call('GET', '/api/now', { token: kim });
    assert.equal(n.body.bodyCheck.due, true);
    assert.equal(n.body.bodyCheck.daysSinceLast, 8);
    await call('PUT', `/api/body/entries/${daysAgo(2)}`, { token: kim, body: { weightKg: 99 } });
    n = await call('GET', '/api/now', { token: kim });
    assert.equal(n.body.bodyCheck.due, false);
    assert.equal(n.body.bodyCheck.weightKg, 99);
  });

  test('summary edge cases', () => {
    const s = bodySummary([{ date: '2026-01-01', weightKg: 80, heightCm: null, waistCm: null, bodyFat: null, note: '' }], { targetWeightKg: null }, '2026-01-03');
    assert.equal(s.bmi, null);
    assert.equal(s.lastWeekChangeKg, null);
    assert.equal(s.avgPerWeekKg, null);
    assert.equal(s.nextDue, '2026-01-08');
  });
});
