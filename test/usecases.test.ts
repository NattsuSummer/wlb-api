// Use-case tests over in-memory repositories: no HTTP, no database — just the business rules.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createContainer } from '../src/container';
import { AppError } from '../src/domain/errors';
import type { Actor } from '../src/domain/user';
import { type Clock } from '../src/services/clock';
import { hashPassword } from '../src/services/password-service';
import { memoryRepositories } from './fakes/memory-repositories';

function setup(startIso = '2026-11-03T13:15:00Z') {
  let now = new Date(startIso);
  const clock: Clock = { now: () => now };
  const repos = memoryRepositories();
  const c = createContainer(repos, clock);
  const addUser = async (username: string, role: 'admin' | 'member' = 'member', password = 'pass-1234') =>
    repos.users.create({ username, displayName: username, passwordHash: await hashPassword(password), role, mustChangePassword: false });
  const actor = async (username: string, password = 'pass-1234'): Promise<Actor> => {
    const r = await c.usecases.login.execute({ username, password, remember: false });
    return (await c.usecases.authenticate.execute(`Bearer ${r.token}`))!;
  };
  return { c, repos, addUser, actor, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

const rejects = async (p: Promise<unknown>, code: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);
};

describe('auth use cases', () => {
  test('lockout expires after 15 minutes (clock is injected)', async () => {
    const s = setup();
    await s.addUser('kim', 'admin');
    for (let i = 0; i < 10; i++) await rejects(s.c.usecases.login.execute({ username: 'kim', password: 'wrong', remember: false }), 'invalid_credentials');
    await rejects(s.c.usecases.login.execute({ username: 'kim', password: 'pass-1234', remember: false }), 'locked');
    s.advance(16 * 60_000);
    const ok = await s.c.usecases.login.execute({ username: 'kim', password: 'pass-1234', remember: false });
    assert.ok(ok.token.startsWith('wls_'));
  });

  test('sessions expire: 1 day normally, 30 days with remember', async () => {
    const s = setup();
    await s.addUser('kim');
    const short = await s.c.usecases.login.execute({ username: 'kim', password: 'pass-1234', remember: false });
    const long = await s.c.usecases.login.execute({ username: 'kim', password: 'pass-1234', remember: true });
    s.advance(2 * 24 * 3600_000);
    assert.equal(await s.c.usecases.authenticate.execute(`Bearer ${short.token}`), null);
    assert.ok(await s.c.usecases.authenticate.execute(`Bearer ${long.token}`));
  });

  test('changing password signs out other sessions but keeps the current one', async () => {
    const s = setup();
    await s.addUser('kim');
    const a = await s.actor('kim');
    const other = await s.c.usecases.login.execute({ username: 'kim', password: 'pass-1234', remember: false });
    await s.c.usecases.changePassword.execute(a, { currentPassword: 'pass-1234', newPassword: 'better-pass-1' });
    assert.equal(await s.c.usecases.authenticate.execute(`Bearer ${other.token}`), null);
    assert.equal(s.repos._tokens.filter((t) => t.kind === 'session').length, 1);
  });
});

describe('schedule use cases', () => {
  test('overwrite needs confirmation; undo cells restore the old value', async () => {
    const s = setup();
    const kim = await s.addUser('kim');
    const a = await s.actor('kim');
    await s.c.usecases.writeRange.execute(a, kim.id, { days: [0], from: 8, to: 10 }, { categoryIds: [2], description: 'งาน' }, false);
    await rejects(s.c.usecases.writeRange.execute(a, kim.id, { days: [0], from: 9, to: 11 }, { categoryIds: [1], description: 'พัก' }, false), 'overwrite_needs_confirm');
    const r = await s.c.usecases.writeRange.execute(a, kim.id, { days: [0], from: 9, to: 11 }, { categoryIds: [1], description: 'พัก' }, true);
    assert.equal(r.overwriteCount, 1);
    assert.equal(r.fillCount, 1);
    await s.c.usecases.setCells.execute(a, kim.id, r.undo);
    const w = await s.repos.schedules.loadWeek(kim.id);
    assert.equal(w[9]!.description, 'งาน');
    assert.equal(w[10], null);
  });

  test('members cannot edit others; admins can', async () => {
    const s = setup();
    const kim = await s.addUser('kim', 'admin');
    const ploy = await s.addUser('ploy');
    const p = await s.actor('ploy');
    await rejects(s.c.usecases.clearRange.execute(p, kim.id, { days: [0], from: 0, to: 1 }), 'forbidden');
    const k = await s.actor('kim');
    const r = await s.c.usecases.writeRange.execute(k, ploy.id, { days: [0], from: 0, to: 1 }, { categoryIds: [1], description: '' }, false);
    assert.equal(r.summary!.plannedHours, 1);
  });

  test('"now" follows the injected clock in Bangkok time', async () => {
    const s = setup('2026-11-03T13:15:00Z'); // Tuesday 20:15 in Bangkok
    const kim = await s.addUser('kim');
    const a = await s.actor('kim');
    await s.c.usecases.writeRange.execute(a, kim.id, { days: [1], from: 20, to: 24 }, { categoryIds: [1, 3], description: 'สตีมเกม' }, false);
    const now = await s.c.usecases.getNow.execute(a);
    assert.equal(now.me!.now!.current!.slot!.description, 'สตีมเกม');
    assert.equal(now.me!.now!.current!.minutesLeft, 225);
    assert.equal(now.me!.summary!.categories.find((c) => c.categoryId === 3)!.hours, 2);
  });
});

describe('admin use cases', () => {
  test('there must always be one active admin', async () => {
    const s = setup();
    const kim = await s.addUser('kim', 'admin');
    const mega = await s.addUser('mega', 'admin');
    const k = await s.actor('kim');
    await s.c.usecases.adminUpdateUser.execute(k, mega.id, { role: 'member' });
    await rejects(s.c.usecases.adminUpdateUser.execute(k, kim.id, { role: 'member' }), 'last_admin');
    const m = await s.actor('mega');
    await rejects(s.c.usecases.adminListUsers.execute(m), 'forbidden');
  });

  test('a category in use cannot be deleted', async () => {
    const s = setup();
    const kim = await s.addUser('kim', 'admin');
    const k = await s.actor('kim');
    await s.c.usecases.writeRange.execute(k, kim.id, { days: [0], from: 0, to: 2 }, { categoryIds: [2], description: '' }, false);
    await rejects(s.c.usecases.deleteTimeCategory.execute(k, 2), 'category_in_use');
    assert.deepEqual(await s.c.usecases.deleteTimeCategory.execute(k, 3), { ok: true });
  });
});
