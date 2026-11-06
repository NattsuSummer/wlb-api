// Courses end to end over HTTP on SQLite: import, catalog, visibility, learning flow, editing, packs, privacy.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { EXAMPLE_COURSE } from '../src/domain/import-guide';
import type { Env } from '../src/index';
import { handle } from '../src/index';
import { hashPassword } from '../src/services/password-service';
import { createTestDb } from './helpers/d1';

let env: Env;
let kim: string, ploy: string, nok: string; // kim = admin, ploy and nok = members

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, headers: res.headers, body: isJson && text ? JSON.parse(text) : text };
}

async function user(username: string, role: 'admin' | 'member' = 'member') {
  await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .bind(username, username, await hashPassword('pass-1234'), role).run();
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'pass-1234' } });
  return r.body.token as string;
}

const course = (over: Record<string, unknown> = {}) => ({
  title: 'Guitar 1',
  description: 'First chords',
  category: 'Music',
  lessons: [
    { title: 'Holding the guitar', content: '# Hold it', exercises: [{ type: 'mcq', prompt: 'Which hand strums?', choices: ['Left', 'Right'], answer: 'Right' }] },
    { title: 'Chord C', content: 'C major', exercises: [{ type: 'text', prompt: 'How did it sound?' }] },
    { title: 'Chord G', links: [{ title: 'Video', url: 'https://youtu.be/abc' }] },
  ],
  ...over,
});

async function create(token: string, body: unknown, query = '') {
  const r = await call('POST', `/api/courses${query}`, { token, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as number;
}

beforeEach(async () => {
  env = { DB: createTestDb(), ALLOWED_ORIGINS: '' };
  kim = await user('kim', 'admin');
  ploy = await user('ploy');
  nok = await user('nok');
});

describe('import format', () => {
  test('the AI guide is public markdown that lists the categories and an example that validates', async () => {
    const g = await call('GET', '/api/import/guide.md');
    assert.equal(g.status, 200);
    assert.match(g.headers.get('content-type')!, /markdown/);
    assert.match(g.body, /Self-growth/);
    const v = await call('POST', '/api/import/validate', { token: ploy, body: EXAMPLE_COURSE });
    assert.deepEqual(v.body.errors, []);
    assert.ok(v.body.warnings.some((w: { path: string }) => w.path === 'pack.title'), 'new pack is a warning');
  });

  test('errors block saving and point at the field; warnings do not', async () => {
    const bad = course({
      category: 'Knitting',
      lessons: [{ title: '', exercises: [{ type: 'mcq', prompt: 'x', choices: ['a'], answer: 3 }], links: [{ url: 'ftp://x' }] }],
    });
    const v = await call('POST', '/api/import/validate', { token: ploy, body: bad });
    const paths = v.body.errors.map((e: { path: string }) => e.path);
    for (const p of ['category', 'lessons[0].title', 'lessons[0].exercises[0].choices', 'lessons[0].exercises[0].answer', 'lessons[0].links[0].url']) assert.ok(paths.includes(p), p);
    assert.equal(v.body.draft, null);
    const r = await call('POST', '/api/courses', { token: ploy, body: bad });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'invalid_course');
    assert.ok(r.body.error.details.errors.length >= 5);
    const none = await call('POST', '/api/import/validate', { token: ploy, body: { title: 'x', lessons: [] } });
    assert.ok(none.body.errors.some((e: { path: string }) => e.path === 'lessons'));
  });

  test('export gives back the same course, and re-importing it validates', async () => {
    const id = await create(ploy, course({ pack: { title: 'Guitar', order: 1 } }));
    const ex = await call('GET', `/api/courses/${id}/export`, { token: ploy });
    assert.equal(ex.body.title, 'Guitar 1');
    assert.equal(ex.body.category, 'Music');
    assert.deepEqual(ex.body.pack, { title: 'Guitar', order: 1 });
    assert.equal(ex.body.lessons[0].exercises[0].answer, 1);
    const v = await call('POST', '/api/import/validate', { token: ploy, body: ex.body });
    assert.deepEqual(v.body.errors, []);
  });
});

describe('visibility and permissions', () => {
  test('group courses are shared; private ones stay with the creator (404 for others)', async () => {
    const shared = await create(ploy, course());
    const secret = await create(ploy, course({ title: 'My notes', visibility: 'private' }));
    const others = await call('GET', '/api/courses', { token: nok });
    assert.deepEqual(others.body.singles.map((c: { id: number }) => c.id), [shared]);
    assert.equal((await call('GET', `/api/courses/${secret}`, { token: nok })).status, 404);
    const mine = await call('GET', '/api/courses', { token: ploy });
    assert.equal(mine.body.singles.length, 2);
    // admins manage everything from the admin list
    const all = await call('GET', '/api/admin/courses', { token: kim });
    assert.equal(all.body.courses.length, 2);
    assert.equal((await call('GET', '/api/admin/courses', { token: ploy })).status, 403);
  });

  test('courses sent with an API token start as drafts; the owner publishes them', async () => {
    const t = await call('POST', '/api/me/tokens', { token: ploy, body: { name: 'claude' } });
    const r = await call('POST', '/api/import/course', { token: t.body.token, body: course() });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'draft');
    assert.equal((await call('GET', '/api/courses', { token: nok })).body.singles.length, 0);
    assert.equal((await call('PATCH', `/api/courses/${r.body.id}`, { token: nok, body: { status: 'published' } })).status, 404);
    assert.equal((await call('PATCH', `/api/courses/${r.body.id}`, { token: ploy, body: { status: 'published' } })).status, 200);
    assert.equal((await call('GET', '/api/courses', { token: nok })).body.singles.length, 1);
  });

  test('only the creator or an admin may edit or delete', async () => {
    const id = await create(ploy, course());
    assert.equal((await call('PUT', `/api/courses/${id}`, { token: nok, body: course({ title: 'Hacked' }) })).status, 403);
    assert.equal((await call('DELETE', `/api/courses/${id}`, { token: nok })).status, 403);
    assert.equal((await call('PUT', `/api/courses/${id}`, { token: kim, body: course({ title: 'Fixed by admin' }) })).status, 200);
    assert.equal((await call('GET', `/api/courses/${id}`, { token: nok })).body.course.title, 'Fixed by admin');
    assert.equal((await call('DELETE', `/api/courses/${id}`, { token: ploy })).status, 200);
    assert.equal((await call('GET', `/api/courses/${id}`, { token: ploy })).status, 404);
  });
});

describe('learning', () => {
  test('lessons: skip warning, hidden mcq answer until tried, progress to done', async () => {
    const id = await create(ploy, course());
    const c = await call('GET', `/api/courses/${id}`, { token: nok });
    const [l1, l2, l3] = c.body.lessons.map((l: { id: number }) => l.id);
    assert.equal(c.body.nextLessonId, l1);

    const second = await call('GET', `/api/lessons/${l2}`, { token: nok });
    assert.deepEqual(second.body.skipped.map((s: { id: number }) => s.id), [l1], 'warn: lesson 1 not done yet');

    const first = await call('GET', `/api/lessons/${l1}`, { token: nok });
    const mcq = first.body.exercises[0];
    assert.equal(mcq.data.answer, undefined, 'answer hidden before trying');
    const wrong = await call('POST', `/api/exercises/${mcq.id}/attempt`, { token: nok, body: { answer: 0 } });
    assert.equal(wrong.body.isCorrect, false);
    assert.equal((await call('POST', `/api/exercises/${mcq.id}/attempt`, { token: nok, body: { answer: 5 } })).status, 400);
    const again = await call('GET', `/api/lessons/${l1}`, { token: nok });
    assert.equal(again.body.exercises[0].data.answer, 1, 'revealed after an attempt');
    assert.equal(again.body.exercises[0].myAttempt.isCorrect, false);

    for (const l of [l1, l2]) await call('POST', `/api/lessons/${l}/complete`, { token: nok });
    let cat = await call('GET', '/api/courses', { token: nok });
    assert.equal(cat.body.inProgress[0].progress.percent, 67);
    const last = await call('POST', `/api/lessons/${l3}/complete`, { token: nok, body: { done: true } });
    assert.equal(last.body.progress.state, 'done');
    cat = await call('GET', '/api/courses', { token: nok });
    assert.equal(cat.body.inProgress.length, 0);
    assert.equal(cat.body.singles[0].progress.state, 'done');
    const undo = await call('POST', `/api/lessons/${l3}/complete`, { token: nok, body: { done: false } });
    assert.equal(undo.body.progress.done, 2);
  });

  test('packs keep order and warn when a later course is started first', async () => {
    const c2 = await create(ploy, course({ title: 'Guitar 2', pack: { title: 'Guitar', order: 2 } }));
    const c1 = await create(ploy, course({ title: 'Guitar 1', pack: 'Guitar' })); // order omitted → goes last
    const c3 = await create(nok, course({ title: 'Guitar 0', pack: { title: 'guitar', order: 1 } })); // anyone may add, title match ignores case
    const cat = await call('GET', '/api/courses', { token: kim });
    assert.equal(cat.body.packs.length, 1);
    assert.deepEqual(cat.body.packs[0].courses.map((c: { id: number }) => c.id), [c3, c2, c1]);
    const g = await call('GET', `/api/courses/${c1}`, { token: kim });
    assert.deepEqual(g.body.skippedCourses.map((c: { id: number }) => c.id), [c3, c2]);
    // deleting the pack keeps its courses as singles
    assert.equal((await call('DELETE', `/api/packs/${cat.body.packs[0].id}`, { token: nok })).status, 403);
    assert.equal((await call('DELETE', `/api/packs/${cat.body.packs[0].id}`, { token: ploy })).status, 200);
    assert.equal((await call('GET', '/api/courses', { token: kim })).body.singles.length, 3);
  });

  test('editing keeps progress on lessons that keep their id', async () => {
    const id = await create(ploy, course());
    const ex = (await call('GET', `/api/courses/${id}/export`, { token: ploy })).body;
    const [l1, l2] = ex.lessons.map((l: { id: number }) => l.id);
    await call('POST', `/api/lessons/${l1}/complete`, { token: nok });
    await call('POST', `/api/lessons/${l2}/complete`, { token: nok });
    // reorder: new lesson first, drop lesson 2, keep 1 and 3 (renamed)
    ex.lessons = [{ title: 'Warm-up', content: 'stretch' }, { ...ex.lessons[0], title: 'Holding it (v2)' }, ex.lessons[2]];
    const r = await call('PUT', `/api/courses/${id}`, { token: ploy, body: ex });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = await call('GET', `/api/courses/${id}`, { token: nok });
    assert.deepEqual(c.body.lessons.map((l: { title: string; completed: boolean }) => [l.title, l.completed]), [
      ['Warm-up', false], ['Holding it (v2)', true], ['Chord G', false],
    ]);
    assert.equal(c.body.lessons[1].id, l1);
    assert.equal(c.body.lessons[1].exerciseCount, 1);
  });
});

describe('privacy', () => {
  test('written answers are shown to others only when the author shares them', async () => {
    const id = await create(ploy, course());
    const l2 = (await call('GET', `/api/courses/${id}`, { token: ploy })).body.lessons[1].id;
    const text = (await call('GET', `/api/lessons/${l2}`, { token: nok })).body.exercises[0];
    await call('POST', `/api/exercises/${text.id}/attempt`, { token: nok, body: { answer: 'Nice and warm' } });
    assert.equal((await call('GET', `/api/lessons/${l2}`, { token: ploy })).body.othersAnswers.length, 0, 'answers are hidden by default');
    const priv = (await call('GET', '/api/me/privacy', { token: nok })).body;
    await call('PUT', '/api/me/privacy', { token: nok, body: { ...(priv.privacy ?? priv), answers: 'show' } });
    const seen = (await call('GET', `/api/lessons/${l2}`, { token: ploy })).body.othersAnswers;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].answer, 'Nice and warm');
    assert.equal(seen[0].user.username, 'nok');
  });

  test('member cards show courses in progress unless hidden', async () => {
    const id = await create(ploy, course());
    const l1 = (await call('GET', `/api/courses/${id}`, { token: nok })).body.lessons[0].id;
    await call('POST', `/api/lessons/${l1}/complete`, { token: nok });
    const card = async () => (await call('GET', '/api/users', { token: ploy })).body.members.find((m: { user: { username: string } }) => m.user.username === 'nok');
    assert.equal((await card()).courses[0].title, 'Guitar 1');
    const priv = (await call('GET', '/api/me/privacy', { token: nok })).body;
    await call('PUT', '/api/me/privacy', { token: nok, body: { ...(priv.privacy ?? priv), courses: 'hide' } });
    assert.equal((await card()).courses, null);
    const now = await call('GET', '/api/now', { token: nok });
    assert.equal(now.body.me.courses.length, 1, 'I always see my own');
  });
});

describe('course categories (admin)', () => {
  test('admins add categories; one in use cannot be deleted', async () => {
    assert.equal((await call('POST', '/api/course-categories', { token: ploy, body: { nameTh: 'ถัก' } })).status, 403);
    const r = await call('POST', '/api/course-categories', { token: kim, body: { nameTh: 'ถักไหมพรม', nameEn: 'Knitting', tint: 'o' } });
    assert.equal(r.status, 201);
    await create(ploy, course({ category: 'ถักไหมพรม' }));
    assert.equal((await call('DELETE', `/api/course-categories/${r.body.id}`, { token: kim })).body.error.code, 'category_in_use');
    assert.equal((await call('POST', '/api/course-categories', { token: kim, body: { nameTh: 'x', tint: 'zz' } })).status, 400);
  });
});
