// Project use cases. Members (and admins) see a project; owners (and admins) change its settings,
// members and can delete it; every member works on tasks, dailies, reviews, versions, events and retros.
import { forbiddenError, notFoundError, validationError } from '../../domain/errors';
import {
  addDays, bangkokDate, buildCalendar, intIn, isDate, isWorkday, LIMITS, LOADS, oneOf, weekdayOf, parseDays, parseEvent, parseProject,
  parseTask, parseVersion, RETRO_COLS, RETRO_PHASES, SIZE_POINTS, sprintNoAt, sprintRange, str, versionSlot, workdaysIn,
  type Project, type ProjectMember, type RetroCard, type Task,
} from '../../domain/project';
import type { Actor } from '../../domain/user';
import type { Deps } from '../deps';

type Body = Record<string, unknown>;
const id = (v: unknown, f = 'id') => intIn(v, f, 1, 1e9);

interface Access { project: Project; members: ProjectMember[]; me: ProjectMember | null; isOwner: boolean }

async function access(d: Deps, a: Actor, projectId: unknown, need: 'view' | 'work' | 'own' = 'view'): Promise<Access> {
  const project = await d.repos.projects.find(id(projectId));
  if (!project) throw notFoundError('Project not found');
  const members = await d.repos.projects.members(project.id);
  const me = members.find((m) => m.userId === a.id) ?? null;
  const admin = a.role === 'admin';
  if (!me && !admin) throw notFoundError('Project not found');
  const isOwner = admin || me?.role === 'owner';
  if (need === 'own' && !isOwner) throw forbiddenError('Only project owners can do this');
  return { project, members, me, isOwner };
}

const today = (d: Deps) => bangkokDate(d.clock.now());

function sprintInfo(p: Project, date: string) {
  const no = Math.max(1, sprintNoAt(p.sprintAnchor, date));
  const r = sprintRange(p.sprintAnchor, no);
  const v = versionSlot(p.sprintAnchor, p.versionWeeks, no);
  return { ...r, started: date >= p.sprintAnchor, versionSlot: v.slot, versionCutDate: v.cutDate, sprintInVersion: no - v.firstSprint + 1 };
}

function summary(p: Project, members: ProjectMember[], tasks: Task[], date: string) {
  const s = sprintInfo(p, date);
  const cur = tasks.filter((t) => t.sprintNo === s.no);
  return {
    sprint: s,
    tasks: { total: cur.length, done: cur.filter((t) => t.status === 'done').length, doing: cur.filter((t) => t.status === 'doing').length, backlog: tasks.filter((t) => t.sprintNo === null && t.status !== 'done').length },
    workingToday: members.filter((m) => isWorkday(m.days, p.sprintAnchor, date)).map((m) => m.userId),
  };
}

// ---------- projects ----------
export class ListProjectsUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor) {
    const list = await this.d.repos.projects.list(a.role === 'admin' ? null : a.id);
    const members = await this.d.repos.projects.membersOfMany(list.map((p) => p.id));
    const date = today(this.d);
    return {
      projects: await Promise.all(list.map(async (p) => {
        const ms = members.filter((m) => m.projectId === p.id);
        const tasks = await this.d.repos.projects.tasks(p.id);
        return { ...p, members: ms, mine: ms.some((m) => m.userId === a.id), ...summary(p, ms, tasks, date) };
      })),
    };
  }
}

export class CreateProjectUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, b: Body) {
    const date = today(this.d);
    // Sprints start on Saturday by default (review + planning that morning).
    let anchor = date;
    while (weekdayOf(anchor) !== 5) anchor = addDays(anchor, 1);
    const w = parseProject({ sprintAnchor: anchor, ...b });
    const pid = await this.d.repos.projects.create(w, a.id);
    const extra = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.map((x) => id(x, 'memberIds')))].filter((u) => u !== a.id) : [];
    await this.checkUsers(extra);
    await this.d.repos.projects.setMembers(pid, [
      { userId: a.id, role: 'owner', days: parseDays(b.myDays) },
      ...extra.map((userId) => ({ userId, role: 'member' as const, days: { weekly: [], alternate: null } })),
    ]);
    return { id: pid };
  }
  async checkUsers(ids: number[]) {
    for (const u of ids) if (!(await this.d.repos.users.findById(u))) throw validationError(`User ${u} not found`, { field: 'members' });
  }
}

export class GetProjectUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown) {
    const { project: p, members, isOwner } = await access(this.d, a, pid);
    const date = today(this.d);
    const [tasks, versions, events] = await Promise.all([this.d.repos.projects.tasks(p.id), this.d.repos.projects.versions(p.id), this.d.repos.projects.events(p.id)]);
    const upcoming = buildCalendar(p, versions, events, date, addDays(date, 35)).filter((e) => e.kind !== 'sprint').slice(0, 8);
    const mineToday = await this.d.repos.projects.todaysDailies(a.id, date);
    return {
      project: p, members, canManage: isOwner, today: date, ...summary(p, members, tasks, date),
      versions, upcoming, myDailyDone: mineToday.includes(p.id),
    };
  }
}

export class UpdateProjectUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const { project } = await access(this.d, a, pid, 'own');
    await this.d.repos.projects.update(project.id, parseProject(b, project));
    return new GetProjectUseCase(this.d).execute(a, project.id);
  }
}

export class DeleteProjectUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown) {
    const { project } = await access(this.d, a, pid, 'own');
    await this.d.repos.projects.remove(project.id);
    return { ok: true };
  }
}

export class SetProjectMembersUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const { project, members } = await access(this.d, a, pid, 'own');
    if (!Array.isArray(b.members)) throw validationError('members must be a list', { field: 'members' });
    const seen = new Set<number>();
    const next: ProjectMember[] = b.members.map((x, i) => {
      const o = (x ?? {}) as Body;
      const userId = id(o.userId, `members[${i}].userId`);
      if (seen.has(userId)) throw validationError('A person is listed twice', { field: 'members' });
      seen.add(userId);
      const old = members.find((m) => m.userId === userId);
      return { userId, role: oneOf(o.role ?? 'member', `members[${i}].role`, ['owner', 'member'] as const), days: o.days === undefined && old ? old.days : parseDays(o.days) };
    });
    if (!next.some((m) => m.role === 'owner')) throw validationError('A project needs at least one owner', { field: 'members' }, 'no_owner');
    await new CreateProjectUseCase(this.d).checkUsers([...seen]);
    await this.d.repos.projects.setMembers(project.id, next);
    return { members: await this.d.repos.projects.members(project.id) };
  }
}

export class SetMyProjectDaysUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const { project, me } = await access(this.d, a, pid);
    if (!me) throw forbiddenError('Only members have work days');
    await this.d.repos.projects.setMemberDays(project.id, a.id, parseDays(b.days ?? b));
    return { members: await this.d.repos.projects.members(project.id) };
  }
}

// ---------- tasks ----------
async function checkTaskRefs(d: Deps, acc: Access, w: { assigneeId: number | null; versionId: number | null }) {
  if (w.assigneeId !== null && !acc.members.some((m) => m.userId === w.assigneeId)) throw validationError('Assignee must be a project member', { field: 'assigneeId' });
  if (w.versionId !== null) {
    const v = await d.repos.projects.findVersion(w.versionId);
    if (!v || v.projectId !== acc.project.id) throw validationError('Version not found in this project', { field: 'versionId' });
  }
}

export class ListTasksUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown) {
    const acc = await access(this.d, a, pid);
    return { tasks: await this.d.repos.projects.tasks(acc.project.id), sprint: sprintInfo(acc.project, today(this.d)) };
  }
}
export class CreateTaskUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const w = parseTask(b);
    await checkTaskRefs(this.d, acc, w);
    const tid = await this.d.repos.projects.createTask(acc.project.id, w, a.id);
    return { task: await this.d.repos.projects.findTask(tid) };
  }
}
export class UpdateTaskUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, tid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const t = await this.d.repos.projects.findTask(id(tid));
    if (!t || t.projectId !== acc.project.id) throw notFoundError('Task not found');
    const w = parseTask(b, t);
    await checkTaskRefs(this.d, acc, w);
    const doneAt = w.status === 'done' ? t.doneAt ?? this.d.clock.now().toISOString() : null;
    await this.d.repos.projects.updateTask(t.id, w, doneAt);
    return { task: await this.d.repos.projects.findTask(t.id) };
  }
}
export class DeleteTaskUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, tid: unknown) {
    const acc = await access(this.d, a, pid, 'work');
    const t = await this.d.repos.projects.findTask(id(tid));
    if (!t || t.projectId !== acc.project.id) throw notFoundError('Task not found');
    await this.d.repos.projects.deleteTask(t.id);
    return { ok: true };
  }
}

// ---------- dailies ----------
export class ListDailiesUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, q: { from?: string | null; to?: string | null }) {
    const acc = await access(this.d, a, pid);
    const date = today(this.d);
    const to = isDate(q.to) ? q.to : date;
    const from = isDate(q.from) ? q.from : addDays(to, -13);
    const list = await this.d.repos.projects.dailies(acc.project.id, from, to);
    const replies = await this.d.repos.projects.replies(list.map((x) => x.id));
    const myLast = await this.d.repos.projects.lastDaily(acc.project.id, a.id, date);
    const days: Record<string, number[]> = {};
    for (let x = from; x <= to; x = addDays(x, 1)) days[x] = acc.members.filter((m) => isWorkday(m.days, acc.project.sprintAnchor, x)).map((m) => m.userId);
    return {
      from, to, today: date, dailies: list.map((x) => ({ ...x, replies: replies.filter((r) => r.dailyId === x.id) })),
      myLastPlan: myLast ? { date: myLast.date, text: myLast.nextText } : null, workdays: days,
    };
  }
}
export class SaveDailyUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, date: unknown, b: Body) {
    const acc = await access(this.d, a, pid);
    if (!acc.me) throw forbiddenError('Only members post dailies');
    if (!isDate(date) || date > today(this.d)) throw validationError('date must be YYYY-MM-DD and not in the future', { field: 'date' });
    const prevDone = b.prevDone === undefined || b.prevDone === null ? null : b.prevDone === true;
    await this.d.repos.projects.upsertDaily({
      projectId: acc.project.id, userId: a.id, date,
      prevText: str(b.prevText, 'prevText', LIMITS.text), prevDone, nextText: str(b.nextText, 'nextText', LIMITS.text, true), blocker: str(b.blocker, 'blocker', LIMITS.text),
    });
    return new ListDailiesUseCase(this.d).execute(a, acc.project.id, {});
  }
}
export class DeleteDailyUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, date: unknown) {
    const acc = await access(this.d, a, pid);
    if (!isDate(date) || !(await this.d.repos.projects.deleteDaily(acc.project.id, a.id, date))) throw notFoundError('No daily on that date');
    return { ok: true };
  }
}
export class ReplyDailyUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, did: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const daily = await this.d.repos.projects.findDaily(id(did));
    if (!daily || daily.projectId !== acc.project.id) throw notFoundError('Daily not found');
    await this.d.repos.projects.addReply(daily.id, a.id, str(b.text, 'text', LIMITS.note, true));
    return { ok: true };
  }
}

// ---------- sprints ----------
export class GetSprintUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, no: unknown) {
    const acc = await access(this.d, a, pid);
    const p = acc.project;
    const n = no === 'current' || no === undefined ? Math.max(1, sprintNoAt(p.sprintAnchor, today(this.d))) : intIn(no, 'sprint', 1, 10000);
    const range = sprintRange(p.sprintAnchor, n);
    const next = sprintRange(p.sprintAnchor, n + 1);
    const tasks = (await this.d.repos.projects.tasks(p.id)).filter((t) => t.sprintNo === n);
    const pts = (t: Task) => (t.size ? SIZE_POINTS[t.size] : 1);
    const people = acc.members.map((m) => {
      const mine = tasks.filter((t) => t.assigneeId === m.userId);
      return {
        userId: m.userId, displayName: m.displayName,
        planned: mine.length, done: mine.filter((t) => t.status === 'done').length,
        plannedPoints: mine.reduce((s, t) => s + pts(t), 0), donePoints: mine.filter((t) => t.status === 'done').reduce((s, t) => s + pts(t), 0),
        workdays: workdaysIn(m.days, p.sprintAnchor, range.start, range.end).length,
        nextWorkdays: workdaysIn(m.days, p.sprintAnchor, next.start, next.end),
        nextPlannedPoints: 0,
      };
    });
    const nextTasks = (await this.d.repos.projects.tasks(p.id)).filter((t) => t.sprintNo === n + 1);
    for (const pp of people) pp.nextPlannedPoints = nextTasks.filter((t) => t.assigneeId === pp.userId).reduce((s, t) => s + pts(t), 0);
    return {
      sprint: { ...range, version: versionSlot(p.sprintAnchor, p.versionWeeks, n) }, next,
      totals: { planned: tasks.length, done: tasks.filter((t) => t.status === 'done').length, carry: tasks.filter((t) => t.status !== 'done').length,
        plannedPoints: tasks.reduce((s, t) => s + pts(t), 0), donePoints: tasks.filter((t) => t.status === 'done').reduce((s, t) => s + pts(t), 0) },
      people, reviews: await this.d.repos.projects.reviews(p.id, n), tasks,
    };
  }
}
export class SaveSprintReviewUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, no: unknown, b: Body) {
    const acc = await access(this.d, a, pid);
    if (!acc.me) throw forbiddenError('Only members review');
    const n = intIn(no, 'sprint', 1, 10000);
    await this.d.repos.projects.setReview(acc.project.id, n, a.id, oneOf(b.load, 'load', LOADS), str(b.note, 'note', LIMITS.note));
    return new GetSprintUseCase(this.d).execute(a, acc.project.id, n);
  }
}
/** Move every unfinished task of sprint n into sprint n + 1. */
export class CarryOverUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, no: unknown) {
    const acc = await access(this.d, a, pid, 'work');
    const n = intIn(no, 'sprint', 1, 10000);
    const tasks = (await this.d.repos.projects.tasks(acc.project.id)).filter((t) => t.sprintNo === n && t.status !== 'done');
    for (const t of tasks) await this.d.repos.projects.updateTask(t.id, { ...t, sprintNo: n + 1 }, t.doneAt);
    return { moved: tasks.length };
  }
}

// ---------- versions ----------
async function ownVersion(d: Deps, acc: Access, vid: unknown) {
  const v = await d.repos.projects.findVersion(id(vid));
  if (!v || v.projectId !== acc.project.id) throw notFoundError('Version not found');
  return v;
}
export class CreateVersionUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const existing = await this.d.repos.projects.versions(acc.project.id);
    // Default dates: the next version slot after the last planned cut (or the current one).
    const p = acc.project;
    const lastCut = existing.map((v) => v.cutDate).filter(Boolean).sort().pop() ?? null;
    const slot = lastCut ? versionSlot(p.sprintAnchor, p.versionWeeks, sprintNoAt(p.sprintAnchor, lastCut) + p.versionWeeks - 1) : versionSlot(p.sprintAnchor, p.versionWeeks, Math.max(1, sprintNoAt(p.sprintAnchor, today(this.d))));
    const w = parseVersion({ name: `v0.${existing.length + 1}`, cutDate: slot.cutDate, ...b });
    const vid = await this.d.repos.projects.createVersion(p.id, w);
    return { version: await this.d.repos.projects.findVersion(vid) };
  }
}
export class UpdateVersionUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, vid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const v = await ownVersion(this.d, acc, vid);
    await this.d.repos.projects.updateVersion(v.id, parseVersion(b, v));
    return { version: await this.d.repos.projects.findVersion(v.id) };
  }
}
export class DeleteVersionUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, vid: unknown) {
    const acc = await access(this.d, a, pid, 'work');
    await this.d.repos.projects.deleteVersion((await ownVersion(this.d, acc, vid)).id);
    return { ok: true };
  }
}
/** Changelog: tasks done that belong to the version (or were done during its sprints). */
export class VersionChangelogUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, vid: unknown) {
    const acc = await access(this.d, a, pid);
    const v = await ownVersion(this.d, acc, vid);
    const tasks = (await this.d.repos.projects.tasks(acc.project.id)).filter((t) => t.status === 'done' && t.versionId === v.id);
    const members = new Map(acc.members.map((m) => [m.userId, m.displayName ?? '']));
    const md = [`# ${v.name}`, v.goal ? `\n${v.goal}\n` : '', ...tasks.map((t) => `- ${t.title}${t.assigneeId ? ` (${members.get(t.assigneeId) ?? ''})` : ''}`)].join('\n');
    return { version: v, tasks, markdown: md };
  }
}

// ---------- calendar & events ----------
export class GetCalendarUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, q: { from?: string | null; to?: string | null }) {
    const acc = await access(this.d, a, pid);
    const date = today(this.d);
    const from = isDate(q.from) ? q.from : `${date.slice(0, 7)}-01`;
    const to = isDate(q.to) ? q.to : addDays(from, 41);
    if (to < from || addDays(from, 400) < to) throw validationError('Range too large', { field: 'to' });
    const [versions, events] = await Promise.all([this.d.repos.projects.versions(acc.project.id), this.d.repos.projects.events(acc.project.id)]);
    const workdays: Record<string, number[]> = {};
    for (let x = from; x <= to; x = addDays(x, 1)) {
      const ids = acc.members.filter((m) => isWorkday(m.days, acc.project.sprintAnchor, x)).map((m) => m.userId);
      if (ids.length) workdays[x] = ids;
    }
    return { from, to, today: date, entries: buildCalendar(acc.project, versions, events, from, to), workdays };
  }
}
async function ownEvent(d: Deps, acc: Access, eid: unknown) {
  const e = await d.repos.projects.findEvent(id(eid));
  if (!e || e.projectId !== acc.project.id) throw notFoundError('Event not found');
  return e;
}
export class CreateEventUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const eid = await this.d.repos.projects.createEvent(acc.project.id, parseEvent(b));
    return { event: await this.d.repos.projects.findEvent(eid) };
  }
}
export class UpdateEventUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, eid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const e = await ownEvent(this.d, acc, eid);
    await this.d.repos.projects.updateEvent(e.id, parseEvent(b, e));
    return { event: await this.d.repos.projects.findEvent(e.id) };
  }
}
export class DeleteEventUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, eid: unknown) {
    const acc = await access(this.d, a, pid, 'work');
    await this.d.repos.projects.deleteEvent((await ownEvent(this.d, acc, eid)).id);
    return { ok: true };
  }
}

// ---------- retros ----------
async function ownRetro(d: Deps, acc: Access, rid: unknown) {
  const r = await d.repos.projects.findRetro(id(rid));
  if (!r || r.projectId !== acc.project.id) throw notFoundError('Retro not found');
  return r;
}
/** What a viewer may see of a card: others' cards stay hidden while writing; anonymous cards hide the author. */
function cardView(c: RetroCard, viewer: number, phase: string) {
  const mine = c.userId === viewer;
  return { id: c.id, col: c.col, text: c.text, anonymous: c.anonymous, mine, userId: c.anonymous && !mine ? null : c.userId,
    votes: phase === 'write' ? 0 : c.votes.length, voted: c.votes.includes(viewer), actionTaskId: c.actionTaskId, createdAt: c.createdAt };
}
export class ListRetrosUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown) {
    const acc = await access(this.d, a, pid);
    return { retros: await this.d.repos.projects.retros(acc.project.id) };
  }
}
export class CreateRetroUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const date = b.date === undefined ? today(this.d) : isDate(b.date) ? b.date : (() => { throw validationError('date must be YYYY-MM-DD', { field: 'date' }); })();
    const title = str(b.title, 'title', LIMITS.title) || `Retro ${date.slice(0, 7)}`;
    return { id: await this.d.repos.projects.createRetro(acc.project.id, title, date) };
  }
}
export class GetRetroUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown) {
    const acc = await access(this.d, a, pid);
    const r = await ownRetro(this.d, acc, rid);
    const cards = await this.d.repos.projects.cards(r.id);
    const visible = r.phase === 'write' ? cards.filter((c) => c.userId === a.id) : cards;
    const counts = Object.fromEntries(RETRO_COLS.map((c) => [c, cards.filter((x) => x.col === c).length]));
    const writers = [...new Set(cards.map((c) => c.userId))].length;
    return { retro: r, cards: visible.map((c) => cardView(c, a.id, r.phase)), counts, writers, canManage: acc.isOwner };
  }
}
export class SetRetroPhaseUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const r = await ownRetro(this.d, acc, rid);
    await this.d.repos.projects.setRetroPhase(r.id, oneOf(b.phase, 'phase', RETRO_PHASES));
    return new GetRetroUseCase(this.d).execute(a, acc.project.id, r.id);
  }
}
export class DeleteRetroUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown) {
    const acc = await access(this.d, a, pid, 'own');
    await this.d.repos.projects.deleteRetro((await ownRetro(this.d, acc, rid)).id);
    return { ok: true };
  }
}
export class AddRetroCardUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown, b: Body) {
    const acc = await access(this.d, a, pid);
    if (!acc.me) throw forbiddenError('Only members write cards');
    const r = await ownRetro(this.d, acc, rid);
    if (r.phase === 'closed') throw validationError('This retro is closed', undefined, 'retro_closed');
    await this.d.repos.projects.addCard(r.id, a.id, oneOf(b.col, 'col', RETRO_COLS), str(b.text, 'text', LIMITS.text, true), b.anonymous === true);
    return new GetRetroUseCase(this.d).execute(a, acc.project.id, r.id);
  }
}
async function ownCard(d: Deps, acc: Access, rid: unknown, cid: unknown) {
  const r = await ownRetro(d, acc, rid);
  const c = await d.repos.projects.findCard(id(cid));
  if (!c || c.retroId !== r.id) throw notFoundError('Card not found');
  return { r, c };
}
export class DeleteRetroCardUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown, cid: unknown) {
    const acc = await access(this.d, a, pid);
    const { r, c } = await ownCard(this.d, acc, rid, cid);
    if (c.userId !== a.id && !acc.isOwner) throw forbiddenError('You can only delete your own cards');
    await this.d.repos.projects.deleteCard(c.id);
    return new GetRetroUseCase(this.d).execute(a, acc.project.id, r.id);
  }
}
export class VoteRetroCardUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown, cid: unknown) {
    const acc = await access(this.d, a, pid, 'work');
    const { r, c } = await ownCard(this.d, acc, rid, cid);
    if (r.phase !== 'reveal') throw validationError('Voting is open after the cards are revealed', undefined, 'not_reveal');
    await this.d.repos.projects.toggleVote(c.id, a.id);
    return new GetRetroUseCase(this.d).execute(a, acc.project.id, r.id);
  }
}
/** Turn a card into a backlog task (an action item for the next sprint). */
export class RetroActionUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, pid: unknown, rid: unknown, cid: unknown, b: Body) {
    const acc = await access(this.d, a, pid, 'work');
    const { r, c } = await ownCard(this.d, acc, rid, cid);
    if (c.actionTaskId) throw validationError('Already an action', undefined, 'already_action');
    const p = acc.project;
    const title = str(b.title, 'title', LIMITS.title) || c.text.slice(0, LIMITS.title);
    const next = Math.max(1, sprintNoAt(p.sprintAnchor, today(this.d))) + 1;
    const tid = await this.d.repos.projects.createTask(p.id, parseTask({ title, description: `Retro: ${r.title}`, sprintNo: next }), a.id);
    await this.d.repos.projects.setCardAction(c.id, tid);
    return new GetRetroUseCase(this.d).execute(a, p.id, r.id);
  }
}

// ---------- home ----------
/** Projects where today is one of my work days, and whether I already posted my daily. */
export async function projectsToday(d: Deps, a: Actor, at: Date) {
  const date = bangkokDate(at);
  const list = await d.repos.projects.list(a.id);
  if (!list.length) return [];
  const members = await d.repos.projects.membersOfMany(list.map((p) => p.id));
  const done = await d.repos.projects.todaysDailies(a.id, date);
  return list.filter((p) => !p.archived).flatMap((p) => {
    const me = members.find((m) => m.projectId === p.id && m.userId === a.id);
    if (!me || !isWorkday(me.days, p.sprintAnchor, date)) return [];
    return [{ id: p.id, name: p.name, dailyDone: done.includes(p.id), sprintNo: Math.max(1, sprintNoAt(p.sprintAnchor, date)) }];
  });
}
