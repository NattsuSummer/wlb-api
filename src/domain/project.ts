// Projects: agile rhythm for a small team. Pure rules only: validation, sprint/version math,
// member work days and the generated calendar (review + planning weekly, retro monthly).
import { validationError } from './errors';

export type ProjectRole = 'owner' | 'member';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskSize = 'S' | 'M' | 'L';
export type Load = 'over' | 'ok' | 'under';
export type EventKind = 'review' | 'retro' | 'cut' | 'release' | 'meeting' | 'other';
export type RetroPhase = 'write' | 'reveal' | 'closed';
export type RetroCol = 'good' | 'bad' | 'vent';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
export const SIZES: TaskSize[] = ['S', 'M', 'L'];
export const SIZE_POINTS: Record<TaskSize, number> = { S: 1, M: 2, L: 4 };
export const LOADS: Load[] = ['over', 'ok', 'under'];
export const EVENT_KINDS: EventKind[] = ['review', 'retro', 'cut', 'release', 'meeting', 'other'];
export const RETRO_PHASES: RetroPhase[] = ['write', 'reveal', 'closed'];
export const RETRO_COLS: RetroCol[] = ['good', 'bad', 'vent'];

export interface Link { title: string; url: string }
export interface WorkDays { weekly: number[]; alternate: [number, number] | null } // weekday 0 = Monday … 6 = Sunday

export interface Project {
  id: number; name: string; description: string; repoUrl: string; refs: Link[];
  sprintAnchor: string; versionWeeks: number; reviewHour: number; retroHour: number; archived: boolean;
  createdBy: number | null; createdAt: string;
}
export interface ProjectMember { userId: number; role: ProjectRole; days: WorkDays; displayName?: string; avatarColor?: string | null }
export interface Task {
  id: number; projectId: number; title: string; description: string; assigneeId: number | null; size: TaskSize | null;
  status: TaskStatus; sprintNo: number | null; versionId: number | null; sort: number; createdBy: number | null; createdAt: string; doneAt: string | null;
}
export interface Version {
  id: number; projectId: number; name: string; goal: string; checklist: { text: string; done: boolean }[];
  cutDate: string | null; releaseDate: string | null; buildUrl: string; playable: boolean | null; notes: string; closed: boolean;
}
export interface Daily { id: number; projectId: number; userId: number; date: string; prevText: string; prevDone: boolean | null; nextText: string; blocker: string; createdAt: string }
export interface DailyReply { id: number; dailyId: number; userId: number; text: string; createdAt: string }
export interface SprintReview { sprintNo: number; userId: number; load: Load; note: string }
export interface ProjectEvent { id: number; projectId: number; kind: EventKind; title: string; date: string; hour: number | null; note: string }
export interface Retro { id: number; projectId: number; title: string; date: string; phase: RetroPhase; createdAt: string }
export interface RetroCard { id: number; retroId: number; userId: number; col: RetroCol; text: string; anonymous: boolean; actionTaskId: number | null; createdAt: string; votes: number[] }

export const LIMITS = { name: 120, description: 4000, title: 200, text: 2000, refs: 20, checklist: 40, note: 1000 } as const;

// ---------- dates ----------
const DAY = 86_400_000;
const OFFSET = 7 * 3_600_000;
export const bangkokDate = (at: Date) => new Date(at.getTime() + OFFSET).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** 0 = Monday … 6 = Sunday (same as the schedule). */
export const weekdayOf = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// ---------- sprints ----------
/** Sprint number containing `date` (sprint 1 starts on the anchor; earlier dates give 0 or less). */
export const sprintNoAt = (anchor: string, date: string) => Math.floor(daysBetween(anchor, date) / 7) + 1;
export const sprintRange = (anchor: string, n: number) => {
  const start = addDays(anchor, (n - 1) * 7);
  return { no: n, start, end: addDays(start, 6) };
};
/** Version slot k covers sprints (k-1)*w+1 … k*w; its default cut day is the day after the slot ends. */
export const versionSlot = (anchor: string, weeks: number, sprintNo: number) => {
  const k = Math.max(1, Math.ceil(sprintNo / weeks));
  return { slot: k, firstSprint: (k - 1) * weeks + 1, lastSprint: k * weeks, cutDate: addDays(anchor, k * weeks * 7) };
};
/** The next sprint-start date on or after `from`. */
export const nextSprintStart = (anchor: string, from: string) => {
  const n = sprintNoAt(anchor, from);
  const s = sprintRange(anchor, Math.max(1, n)).start;
  return s >= from ? s : sprintRange(anchor, n + 1).start;
};

export function isWorkday(days: WorkDays, anchor: string, date: string) {
  const wd = weekdayOf(date);
  if (days.weekly.includes(wd)) return true;
  if (!days.alternate) return false;
  const odd = Math.abs(sprintNoAt(anchor, date)) % 2 === 1;
  return wd === (odd ? days.alternate[0] : days.alternate[1]);
}
export function workdaysIn(days: WorkDays, anchor: string, from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(days, anchor, d)) out.push(d);
  return out;
}

// ---------- calendar ----------
export interface CalendarEntry { kind: EventKind | 'sprint'; title: string; date: string; hour: number | null; note: string; eventId?: number; versionId?: number; auto?: boolean }

export function buildCalendar(p: Project, versions: Version[], events: ProjectEvent[], from: string, to: string): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const e of events) if (e.date >= from && e.date <= to) out.push({ kind: e.kind, title: e.title, date: e.date, hour: e.hour, note: e.note, eventId: e.id });
  for (const v of versions) {
    if (v.cutDate && v.cutDate >= from && v.cutDate <= to) out.push({ kind: 'cut', title: v.name, date: v.cutDate, hour: null, note: v.goal, versionId: v.id });
    if (v.releaseDate && v.releaseDate >= from && v.releaseDate <= to) out.push({ kind: 'release', title: v.name, date: v.releaseDate, hour: null, note: v.goal, versionId: v.id });
  }
  // Weekly review + planning on each sprint start, unless a review event was put in that sprint by hand (moved).
  const first = Math.max(1, sprintNoAt(p.sprintAnchor, from));
  for (let n = first; ; n++) {
    const { start, end } = sprintRange(p.sprintAnchor, n);
    if (start > to) break;
    if (start < from) continue;
    const prev = sprintRange(p.sprintAnchor, n - 1);
    const moved = events.some((e) => e.kind === 'review' && e.date >= addDays(start, -3) && e.date <= addDays(start, 3));
    if (!moved && n > 1) out.push({ kind: 'review', title: `Sprint ${n - 1} review + Sprint ${n} planning`, date: start, hour: p.reviewHour, note: `${prev.start} – ${prev.end}`, auto: true });
    out.push({ kind: 'sprint', title: `Sprint ${n}`, date: start, hour: null, note: `${start} – ${end}`, auto: true });
  }
  // Monthly retro: first sprint-start weekday of each month, unless a retro event exists that month.
  const sw = weekdayOf(p.sprintAnchor);
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) {
    let d = `${m}-01`;
    while (weekdayOf(d) !== sw) d = addDays(d, 1);
    if (d < from || d > to || d < p.sprintAnchor) continue;
    if (events.some((e) => e.kind === 'retro' && e.date.startsWith(m))) continue;
    out.push({ kind: 'retro', title: 'Retro', date: d, hour: p.retroHour, note: '', auto: true });
  }
  const order: Record<string, number> = { sprint: 0, review: 1, retro: 2, cut: 3, release: 4, meeting: 5, other: 6 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.hour ?? -1) - (b.hour ?? -1) || order[a.kind]! - order[b.kind]!);
}

// ---------- validation helpers ----------
type Obj = Record<string, unknown>;
export const str = (v: unknown, field: string, max: number, required = false): string => {
  if (v === undefined || v === null) { if (required) throw validationError(`${field} is required`, { field }); return ''; }
  if (typeof v !== 'string') throw validationError(`${field} must be text`, { field });
  const s = v.trim();
  if (required && !s) throw validationError(`${field} is required`, { field });
  if (s.length > max) throw validationError(`${field} must be at most ${max} characters`, { field });
  return s;
};
const url = (v: unknown, field: string): string => {
  const s = str(v, field, 500);
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw validationError(`${field} must be an http(s) URL`, { field });
  return s;
};
export const intIn = (v: unknown, field: string, min: number, max: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw validationError(`${field} must be a whole number ${min}–${max}`, { field });
  return n;
};
export const optDate = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw validationError(`${field} must be YYYY-MM-DD`, { field });
  return v;
};
export const oneOf = <T extends string>(v: unknown, field: string, list: readonly T[]): T => {
  if (typeof v !== 'string' || !list.includes(v as T)) throw validationError(`${field} must be one of: ${list.join(', ')}`, { field });
  return v as T;
};
const links = (v: unknown, field: string): Link[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw validationError(`${field} must be a list`, { field });
  if (v.length > LIMITS.refs) throw validationError(`${field}: at most ${LIMITS.refs}`, { field });
  return v.map((x, i) => {
    const o = (typeof x === 'string' ? { url: x } : x) as Obj;
    const u = url(o?.url, `${field}[${i}].url`);
    if (!u) throw validationError(`${field}[${i}].url is required`, { field });
    return { title: str(o.title, `${field}[${i}].title`, LIMITS.title) || u, url: u };
  });
};

export interface ProjectWrite { name: string; description: string; repoUrl: string; refs: Link[]; sprintAnchor: string; versionWeeks: number; reviewHour: number; retroHour: number; archived: boolean }
export function parseProject(b: Obj, current?: Project): ProjectWrite {
  const has = (k: string) => b[k] !== undefined;
  const anchor = has('sprintAnchor') ? optDate(b.sprintAnchor, 'sprintAnchor') : current?.sprintAnchor ?? null;
  if (!anchor) throw validationError('sprintAnchor (first day of sprint 1) is required', { field: 'sprintAnchor' });
  return {
    name: has('name') || !current ? str(b.name, 'name', LIMITS.name, true) : current.name,
    description: has('description') || !current ? str(b.description, 'description', LIMITS.description) : current.description,
    repoUrl: has('repoUrl') || !current ? url(b.repoUrl, 'repoUrl') : current.repoUrl,
    refs: has('refs') || !current ? links(b.refs, 'refs') : current.refs,
    sprintAnchor: anchor,
    versionWeeks: has('versionWeeks') ? intIn(b.versionWeeks, 'versionWeeks', 1, 12) : current?.versionWeeks ?? 2,
    reviewHour: has('reviewHour') ? intIn(b.reviewHour, 'reviewHour', 0, 23) : current?.reviewHour ?? 9,
    retroHour: has('retroHour') ? intIn(b.retroHour, 'retroHour', 0, 23) : current?.retroHour ?? 10,
    archived: has('archived') ? b.archived === true : current?.archived ?? false,
  };
}

export function parseDays(v: unknown): WorkDays {
  const o = (v ?? {}) as Obj;
  const wd = (x: unknown, f: string) => intIn(x, f, 0, 6);
  const weekly = Array.isArray(o.weekly) ? [...new Set(o.weekly.map((x, i) => wd(x, `days.weekly[${i}]`)))].sort() : [];
  let alternate: [number, number] | null = null;
  if (Array.isArray(o.alternate) && o.alternate.length) {
    if (o.alternate.length !== 2) throw validationError('days.alternate must be two weekdays [odd sprints, even sprints]', { field: 'days.alternate' });
    alternate = [wd(o.alternate[0], 'days.alternate[0]'), wd(o.alternate[1], 'days.alternate[1]')];
  }
  return { weekly, alternate };
}

export interface TaskWrite { title: string; description: string; assigneeId: number | null; size: TaskSize | null; status: TaskStatus; sprintNo: number | null; versionId: number | null; sort: number }
export function parseTask(b: Obj, current?: Task): TaskWrite {
  const has = (k: string) => b[k] !== undefined;
  const nullable = <T>(k: string, f: (v: unknown) => T, cur: T | null): T | null => (has(k) ? (b[k] === null || b[k] === '' ? null : f(b[k])) : cur);
  return {
    title: has('title') || !current ? str(b.title, 'title', LIMITS.title, true) : current.title,
    description: has('description') || !current ? str(b.description, 'description', LIMITS.description) : current.description,
    assigneeId: nullable('assigneeId', (v) => intIn(v, 'assigneeId', 1, 1e9), current?.assigneeId ?? null),
    size: nullable('size', (v) => oneOf(v, 'size', SIZES), current?.size ?? null),
    status: has('status') ? oneOf(b.status, 'status', TASK_STATUSES) : current?.status ?? 'todo',
    sprintNo: nullable('sprintNo', (v) => intIn(v, 'sprintNo', 1, 10000), current?.sprintNo ?? null),
    versionId: nullable('versionId', (v) => intIn(v, 'versionId', 1, 1e9), current?.versionId ?? null),
    sort: has('sort') ? (typeof b.sort === 'number' && Number.isFinite(b.sort) ? b.sort : 0) : current?.sort ?? Date.now() / 1000,
  };
}

export type VersionWrite = Omit<Version, 'id' | 'projectId'>;
export function parseVersion(b: Obj, current?: Version): VersionWrite {
  const has = (k: string) => b[k] !== undefined;
  let checklist = current?.checklist ?? [];
  if (has('checklist')) {
    if (!Array.isArray(b.checklist)) throw validationError('checklist must be a list', { field: 'checklist' });
    if (b.checklist.length > LIMITS.checklist) throw validationError(`checklist: at most ${LIMITS.checklist}`, { field: 'checklist' });
    checklist = b.checklist.map((x, i) => {
      const o = (typeof x === 'string' ? { text: x } : x) as Obj;
      return { text: str(o?.text, `checklist[${i}].text`, LIMITS.title, true), done: o?.done === true };
    });
  }
  const cutDate = has('cutDate') ? optDate(b.cutDate, 'cutDate') : current?.cutDate ?? null;
  const releaseDate = has('releaseDate') ? optDate(b.releaseDate, 'releaseDate') : current?.releaseDate ?? null;
  if (cutDate && releaseDate && releaseDate < cutDate) throw validationError('releaseDate cannot be before cutDate', { field: 'releaseDate' });
  return {
    name: has('name') || !current ? str(b.name, 'name', LIMITS.name, true) : current.name,
    goal: has('goal') || !current ? str(b.goal, 'goal', LIMITS.text) : current.goal,
    checklist, cutDate, releaseDate,
    buildUrl: has('buildUrl') || !current ? url(b.buildUrl, 'buildUrl') : current.buildUrl,
    playable: has('playable') ? (b.playable === null ? null : b.playable === true) : current?.playable ?? null,
    notes: has('notes') || !current ? str(b.notes, 'notes', LIMITS.description) : current.notes,
    closed: has('closed') ? b.closed === true : current?.closed ?? false,
  };
}

export type EventWrite = Omit<ProjectEvent, 'id' | 'projectId'>;
export function parseEvent(b: Obj, current?: ProjectEvent): EventWrite {
  const has = (k: string) => b[k] !== undefined;
  const date = has('date') || !current ? optDate(b.date, 'date') : current.date;
  if (!date) throw validationError('date is required', { field: 'date' });
  return {
    kind: has('kind') || !current ? oneOf(b.kind ?? 'meeting', 'kind', EVENT_KINDS) : current.kind,
    title: has('title') || !current ? str(b.title, 'title', LIMITS.title) : current.title,
    date,
    hour: has('hour') ? (b.hour === null || b.hour === '' ? null : intIn(b.hour, 'hour', 0, 23)) : current?.hour ?? null,
    note: has('note') || !current ? str(b.note, 'note', LIMITS.note) : current.note,
  };
}
