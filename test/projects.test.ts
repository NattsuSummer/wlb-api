// Projects over HTTP on SQLite: membership, tasks, dailies, sprints, versions, calendar, retros.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { addDays, bangkokDate, buildCalendar, isWorkday, sprintNoAt, weekdayOf, type Project } from '../src/domain/project';
import type { Env } from '../src/index';
import { handle } from '../src/index';
import { hashPassword } from '../src/services/password-service';
import { createTestDb } from './helpers/d1';

let env: Env;
let kim: string, mega: string, ploy: string, admin: string;
const ids: Record<string, number> = {};
const today = bangkokDate(new Date());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text };
}
async function user(username: string, role = 'member') {
  const r = await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .bind(username, username, await hashPassword('pass-1234'), role).run();
  ids[username] = Number(r.meta.last_row_id);
  return (await call('POST', '/api/auth/login', undefined, { username, password: 'pass-1234' })).body.token as string;
}
// A Saturday about two weeks ago, so we are inside sprint 3.
let anchor = addDays(today, -14);
while (weekdayOf(anchor) !== 5) anchor = addDays(anchor, -1);

async function newProject(extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/api/projects', kim, { name: 'Dungeon game', description: 'roguelike', repoUrl: 'https://github.com/x/game',
    refs: [{ title: 'GDD', url: 'https://docs.example.com/gdd' }], sprintAnchor: anchor, memberIds: [ids.mega], myDays: { weekly: [1, 5, 6], alternate: [3, 4] }, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as number;
}

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: '', WEB_URL: 'https://web.test' };
  kim = await user('kim'); mega = await user('mega'); ploy = await user('ploy'); admin = await user('boss', 'admin');
});

describe('project domain', () => {
  test('work days with alternating days per sprint', () => {
    const days = { weekly: [1], alternate: [3, 4] as [number, number] };
    const s1 = '2026-11-07'; // a Saturday, sprint 1
    assert.equal(weekdayOf(s1), 5);
    const thu1 = addDays(s1, 5), fri1 = addDays(s1, 6), thu2 = addDays(s1, 12), fri2 = addDays(s1, 13);
    assert.equal(isWorkday(days, s1, thu1), true);
    assert.equal(isWorkday(days, s1, fri1), false);
    assert.equal(isWorkday(days, s1, thu2), false);
    assert.equal(isWorkday(days, s1, fri2), true);
    assert.equal(isWorkday(days, s1, addDays(s1, 3)), true); // Tuesday every week
    assert.equal(sprintNoAt(s1, addDays(s1, 7)), 2);
  });
  test('calendar: weekly review, monthly retro, moved review, version dates', () => {
    const p = { id: 1, sprintAnchor: '2026-11-07', reviewHour: 9, retroHour: 10, versionWeeks: 2 } as Project;
    const cal = buildCalendar(p, [{ id: 1, name: 'v0.1', cutDate: '2026-11-21', releaseDate: '2026-11-22', goal: '' } as never],
      [{ id: 9, projectId: 1, kind: 'review', title: 'moved', date: '2026-11-15', hour: 13, note: '' }], '2026-11-01', '2026-12-31');
    const reviews = cal.filter((e) => e.kind === 'review');
    assert.ok(reviews.some((e) => e.title === 'moved'));
    assert.ok(!reviews.some((e) => e.auto && e.date === '2026-11-14'));
    assert.ok(reviews.some((e) => e.auto && e.date === '2026-11-21'));
    assert.deepEqual(cal.filter((e) => e.kind === 'retro').map((e) => e.date), ['2026-11-07', '2026-12-05']);
    assert.ok(cal.some((e) => e.kind === 'cut' && e.date === '2026-11-21'));
    assert.ok(cal.some((e) => e.kind === 'release' && e.date === '2026-11-22'));
  });
});

describe('projects', () => {
  test('create, visibility and settings', async () => {
    assert.equal((await call('GET', '/api/projects')).status, 401);
    const pid = await newProject();
    let r = await call('GET', `/api/projects/${pid}`, kim);
    assert.equal(r.status, 200);
    assert.equal(r.body.project.repoUrl, 'https://github.com/x/game');
    assert.equal(r.body.project.refs[0].title, 'GDD');
    assert.equal(r.body.members.length, 2);
    assert.equal(r.body.canManage, true);
    assert.equal(r.body.sprint.no, 3);
    assert.equal((await call('GET', `/api/projects/${pid}`, mega)).body.canManage, false);
    assert.equal((await call('GET', `/api/projects/${pid}`, ploy)).status, 404);
    assert.equal((await call('GET', `/api/projects/${pid}`, admin)).status, 200);
    assert.equal((await call('GET', '/api/projects', ploy)).body.projects.length, 0);
    assert.equal((await call('GET', '/api/projects', mega)).body.projects.length, 1);
    assert.equal((await call('PATCH', `/api/projects/${pid}`, mega, { name: 'x' })).status, 403);
    r = await call('PATCH', `/api/projects/${pid}`, kim, { name: 'Dungeon 2', versionWeeks: 3 });
    assert.equal(r.body.project.name, 'Dungeon 2');
    assert.equal(r.body.project.versionWeeks, 3);
    assert.equal((await call('PATCH', `/api/projects/${pid}`, kim, { repoUrl: 'ftp://x' })).status, 400);
    assert.equal((await call('POST', '/api/projects', kim, { name: '' })).status, 400);
    // default anchor is a Saturday
    const r2 = await call('POST', '/api/projects', kim, { name: 'Other' });
    assert.equal(weekdayOf((await call('GET', `/api/projects/${r2.body.id}`, kim)).body.project.sprintAnchor), 5);
    assert.equal((await call('DELETE', `/api/projects/${pid}`, mega)).status, 403);
    assert.equal((await call('DELETE', `/api/projects/${pid}`, kim)).status, 200);
    assert.equal((await call('GET', `/api/projects/${pid}`, kim)).status, 404);
  });

  test('members and work days', async () => {
    const pid = await newProject();
    assert.equal((await call('PUT', `/api/projects/${pid}/members`, mega, { members: [] })).status, 403);
    assert.equal((await call('PUT', `/api/projects/${pid}/members`, kim, { members: [{ userId: ids.mega, role: 'member' }] })).body.error.code, 'no_owner');
    let r = await call('PUT', `/api/projects/${pid}/members`, kim, { members: [{ userId: ids.kim, role: 'owner' }, { userId: ids.ploy }, { userId: ids.mega, role: 'owner' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.members.length, 3);
    assert.deepEqual(r.body.members.find((m: { userId: number }) => m.userId === ids.kim).days, { weekly: [1, 5, 6], alternate: [3, 4] }); // kept
    r = await call('PUT', `/api/projects/${pid}/my-days`, ploy, { days: { weekly: [6, 5, 5] } });
    assert.deepEqual(r.body.members.find((m: { userId: number }) => m.userId === ids.ploy).days, { weekly: [5, 6], alternate: null });
    assert.equal((await call('PUT', `/api/projects/${pid}/my-days`, ploy, { days: { weekly: [9] } })).status, 400);
    assert.equal((await call('GET', `/api/projects/${pid}`, ploy)).status, 200);
  });

  test('tasks', async () => {
    const pid = await newProject();
    assert.equal((await call('POST', `/api/projects/${pid}/tasks`, ploy, { title: 'x' })).status, 404);
    assert.equal((await call('POST', `/api/projects/${pid}/tasks`, kim, { title: 'x', assigneeId: ids.ploy })).status, 400);
    let r = await call('POST', `/api/projects/${pid}/tasks`, mega, { title: 'Player movement', assigneeId: ids.mega, size: 'M', sprintNo: 3 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const tid = r.body.task.id;
    assert.equal(r.body.task.status, 'todo');
    r = await call('PATCH', `/api/projects/${pid}/tasks/${tid}`, kim, { status: 'done' });
    assert.ok(r.body.task.doneAt);
    r = await call('PATCH', `/api/projects/${pid}/tasks/${tid}`, kim, { status: 'doing' });
    assert.equal(r.body.task.doneAt, null);
    assert.equal((await call('PATCH', `/api/projects/${pid}/tasks/${tid}`, kim, { size: 'XL' })).status, 400);
    await call('POST', `/api/projects/${pid}/tasks`, kim, { title: 'Backlog idea' });
    r = await call('GET', `/api/projects/${pid}/tasks`, kim);
    assert.equal(r.body.tasks.length, 2);
    assert.equal(r.body.sprint.no, 3);
    assert.equal((await call('DELETE', `/api/projects/${pid}/tasks/${tid}`, kim)).status, 200);
  });

  test('dailies, replies and the home reminder', async () => {
    const pid = await newProject({ myDays: { weekly: [0, 1, 2, 3, 4, 5, 6] } });
    let n = await call('GET', '/api/now', kim);
    assert.deepEqual(n.body.projectsToday.map((p: { dailyDone: boolean }) => p.dailyDone), [false]);
    await call('PUT', `/api/projects/${pid}/dailies/${addDays(today, -2)}`, kim, { nextText: 'Make the map' });
    let r = await call('GET', `/api/projects/${pid}/dailies`, kim);
    assert.deepEqual(r.body.myLastPlan, { date: addDays(today, -2), text: 'Make the map' });
    r = await call('PUT', `/api/projects/${pid}/dailies/${today}`, kim, { prevText: 'Make the map', prevDone: true, nextText: 'Enemies', blocker: 'need art' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dailies.length, 2);
    assert.equal(r.body.dailies[0].prevDone, true);
    assert.ok(r.body.workdays[today].includes(ids.kim));
    assert.equal((await call('PUT', `/api/projects/${pid}/dailies/${addDays(today, 1)}`, kim, { nextText: 'x' })).status, 400);
    assert.equal((await call('PUT', `/api/projects/${pid}/dailies/${today}`, kim, {})).status, 400);
    assert.equal((await call('PUT', `/api/projects/${pid}/dailies/${today}`, admin, { nextText: 'x' })).status, 403);
    const did = r.body.dailies[0].id;
    assert.equal((await call('POST', `/api/projects/${pid}/dailies/${did}/replies`, mega, { text: 'I can draw' })).status, 201);
    r = await call('GET', `/api/projects/${pid}/dailies`, mega);
    assert.equal(r.body.dailies[0].replies[0].text, 'I can draw');
    n = await call('GET', '/api/now', kim);
    assert.equal(n.body.projectsToday[0].dailyDone, true);
  });

  test('sprint summary, review and carry-over', async () => {
    const pid = await newProject();
    const t1 = (await call('POST', `/api/projects/${pid}/tasks`, kim, { title: 'A', assigneeId: ids.kim, size: 'L', sprintNo: 3 })).body.task.id;
    await call('POST', `/api/projects/${pid}/tasks`, kim, { title: 'B', assigneeId: ids.mega, size: 'S', sprintNo: 3 });
    await call('PATCH', `/api/projects/${pid}/tasks/${t1}`, kim, { status: 'done' });
    let r = await call('GET', `/api/projects/${pid}/sprints/current`, kim);
    assert.equal(r.body.sprint.no, 3);
    assert.deepEqual(r.body.totals, { planned: 2, done: 1, carry: 1, plannedPoints: 5, donePoints: 4 });
    const k = r.body.people.find((p: { userId: number }) => p.userId === ids.kim);
    assert.equal(k.donePoints, 4);
    assert.equal(k.nextWorkdays.length, 4); // Tue, Sat, Sun + Thu or Fri
    r = await call('PUT', `/api/projects/${pid}/sprints/3/review`, mega, { load: 'over', note: 'too much' });
    assert.equal(r.body.reviews[0].load, 'over');
    assert.equal((await call('PUT', `/api/projects/${pid}/sprints/3/review`, mega, { load: 'meh' })).status, 400);
    r = await call('POST', `/api/projects/${pid}/sprints/3/carry-over`, kim);
    assert.equal(r.body.moved, 1);
    r = await call('GET', `/api/projects/${pid}/sprints/4`, kim);
    assert.equal(r.body.totals.planned, 1);
  });

  test('versions, changelog, events and calendar', async () => {
    const pid = await newProject();
    let r = await call('POST', `/api/projects/${pid}/versions`, kim, { goal: 'Walk and fight', checklist: ['walk', { text: 'fight', done: true }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const v = r.body.version;
    assert.equal(v.name, 'v0.1');
    assert.equal(v.cutDate, addDays(anchor, 28)); // sprint 3 is in slot 2 → cut after sprint 4
    assert.equal(v.checklist[1].done, true);
    r = await call('POST', `/api/projects/${pid}/versions`, kim, {});
    assert.equal(r.body.version.name, 'v0.2');
    assert.equal(r.body.version.cutDate, addDays(anchor, 42));
    r = await call('PATCH', `/api/projects/${pid}/versions/${v.id}`, kim, { releaseDate: addDays(anchor, 29), playable: true, buildUrl: 'https://itch.io/x' });
    assert.equal(r.body.version.playable, true);
    assert.equal((await call('PATCH', `/api/projects/${pid}/versions/${v.id}`, kim, { releaseDate: addDays(anchor, 1) })).status, 400);
    const t = (await call('POST', `/api/projects/${pid}/tasks`, kim, { title: 'Sword', versionId: v.id, assigneeId: ids.mega })).body.task.id;
    await call('PATCH', `/api/projects/${pid}/tasks/${t}`, kim, { status: 'done' });
    r = await call('GET', `/api/projects/${pid}/versions/${v.id}/changelog`, kim);
    assert.match(r.body.markdown, /- Sword \(mega\)/);
    r = await call('POST', `/api/projects/${pid}/events`, mega, { kind: 'meeting', title: 'Playtest', date: addDays(anchor, 30), hour: 20 });
    assert.equal(r.status, 201);
    const eid = r.body.event.id;
    assert.equal((await call('POST', `/api/projects/${pid}/events`, mega, { kind: 'party', date: today })).status, 400);
    r = await call('GET', `/api/projects/${pid}/calendar?from=${anchor}&to=${addDays(anchor, 45)}`, kim);
    const kinds = (k: string) => r.body.entries.filter((e: { kind: string }) => e.kind === k);
    assert.ok(kinds('cut').some((e: { date: string }) => e.date === addDays(anchor, 28)));
    assert.ok(kinds('release').length === 1);
    assert.ok(kinds('meeting')[0].title === 'Playtest');
    assert.ok(kinds('review').length >= 5);
    assert.ok(Object.keys(r.body.workdays).length > 10);
    await call('PATCH', `/api/projects/${pid}/events/${eid}`, mega, { hour: null });
    assert.equal((await call('DELETE', `/api/projects/${pid}/events/${eid}`, mega)).status, 200);
    r = await call('GET', `/api/projects/${pid}`, kim);
    assert.equal(r.body.versions.length, 2);
  });

  test('retro: hidden while writing, anonymous, votes, actions', async () => {
    const pid = await newProject();
    const rid = (await call('POST', `/api/projects/${pid}/retros`, kim, {})).body.id;
    await call('POST', `/api/projects/${pid}/retros/${rid}/cards`, kim, { col: 'good', text: 'Shipped v0.1' });
    let r = await call('POST', `/api/projects/${pid}/retros/${rid}/cards`, mega, { col: 'vent', text: 'Merge conflicts every day!!', anonymous: true });
    assert.equal(r.body.cards.length, 1); // mega sees only their own while writing
    assert.deepEqual(r.body.counts, { good: 1, bad: 0, vent: 1 });
    assert.equal(r.body.writers, 2);
    assert.equal((await call('POST', `/api/projects/${pid}/retros/${rid}/cards`, mega, { col: 'angry', text: 'x' })).status, 400);
    const cid = r.body.cards[0].id;
    assert.equal((await call('POST', `/api/projects/${pid}/retros/${rid}/cards/${cid}/vote`, kim)).status, 400); // not revealed yet
    r = await call('PATCH', `/api/projects/${pid}/retros/${rid}`, kim, { phase: 'reveal' });
    assert.equal(r.body.cards.length, 2);
    const vent = r.body.cards.find((c: { col: string }) => c.col === 'vent');
    assert.equal(vent.userId, null); // anonymous to others
    assert.equal((await call('GET', `/api/projects/${pid}/retros/${rid}`, mega)).body.cards.find((c: { col: string }) => c.col === 'vent').userId, ids.mega);
    r = await call('POST', `/api/projects/${pid}/retros/${rid}/cards/${vent.id}/vote`, kim);
    assert.equal(r.body.cards.find((c: { id: number }) => c.id === vent.id).votes, 1);
    r = await call('POST', `/api/projects/${pid}/retros/${rid}/cards/${vent.id}/vote`, kim);
    assert.equal(r.body.cards.find((c: { id: number }) => c.id === vent.id).votes, 0);
    assert.equal((await call('DELETE', `/api/projects/${pid}/retros/${rid}/cards/${vent.id}`, kim)).status, 200); // owner may remove
    const good = r.body.cards.find((c: { col: string }) => c.col === 'good');
    r = await call('POST', `/api/projects/${pid}/retros/${rid}/cards/${good.id}/action`, mega, { title: 'Keep weekly builds' });
    assert.ok(r.body.cards.find((c: { id: number }) => c.id === good.id).actionTaskId);
    const tasks = (await call('GET', `/api/projects/${pid}/tasks`, kim)).body.tasks;
    assert.equal(tasks[0].title, 'Keep weekly builds');
    assert.equal(tasks[0].sprintNo, 4);
    await call('PATCH', `/api/projects/${pid}/retros/${rid}`, kim, { phase: 'closed' });
    assert.equal((await call('POST', `/api/projects/${pid}/retros/${rid}/cards`, kim, { col: 'good', text: 'late' })).status, 400);
    assert.equal((await call('GET', `/api/projects/${pid}/retros`, mega)).body.retros.length, 1);
    assert.equal((await call('DELETE', `/api/projects/${pid}/retros/${rid}`, mega)).status, 403);
  });
});
