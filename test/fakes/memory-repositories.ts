// In-memory implementations of the repository interfaces, for fast use-case tests with no database.
import type { ApiTokenInfo, CourseCategory, TimeCategory } from '../../src/domain/category';
import { DEFAULT_PRIVACY, type Privacy } from '../../src/domain/privacy';
import { emptyWeek, type Slot, type Week } from '../../src/domain/schedule';
import { slotIndex } from '../../src/domain/time';
import type { User } from '../../src/domain/user';
import type { NewToken, NewUser, Repositories, UserPatch } from '../../src/repositories/interfaces';

interface StoredUser extends User { passwordHash: string; failedLogins: number; lockedUntil: string | null }
interface StoredToken extends NewToken { lastUsedAt: string | null; createdAt: string }

export function memoryRepositories(categories: Omit<TimeCategory, 'sort'>[] = DEFAULT_CATS): Repositories & { _users: StoredUser[]; _tokens: StoredToken[] } {
  const users: StoredUser[] = [];
  const tokens: StoredToken[] = [];
  const cats: TimeCategory[] = categories.map((c, i) => ({ ...c, sort: i + 1 }));
  const weeks = new Map<number, Week>();
  const targets = new Map<number, Record<number, number>>();
  const privacy = new Map<number, Privacy>();
  const weekOf = (id: number) => weeks.get(id) ?? emptyWeek();
  const strip = ({ passwordHash, failedLogins, lockedUntil, ...u }: StoredUser): User => u;

  return {
    _users: users,
    _tokens: tokens,
    users: {
      findById: async (id) => { const u = users.find((x) => x.id === id); return u ? strip(u) : null; },
      findByUsername: async (n) => { const u = users.find((x) => x.username === n.toLowerCase()); return u ? strip(u) : null; },
      credentialsByUsername: async (n) => { const u = users.find((x) => x.username === n.toLowerCase()); return u ? { id: u.id, passwordHash: u.passwordHash, disabled: u.disabled, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil } : null; },
      credentialsById: async (id) => { const u = users.find((x) => x.id === id); return u ? { id: u.id, passwordHash: u.passwordHash, disabled: u.disabled, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil } : null; },
      list: async (o = {}) => users.filter((u) => o.includeDisabled || !u.disabled).map(strip),
      create: async (n: NewUser) => {
        const u: StoredUser = { id: users.length + 1, username: n.username, displayName: n.displayName, role: n.role, locale: 'th', theme: 'dark', avatarColor: n.avatarColor ?? null,
          mustChangePassword: n.mustChangePassword, disabled: false, lastLoginAt: null, createdAt: new Date(0).toISOString(), passwordHash: n.passwordHash, failedLogins: 0, lockedUntil: null };
        users.push(u);
        return strip(u);
      },
      update: async (id, p: UserPatch) => { Object.assign(users.find((x) => x.id === id)!, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))); },
      countActiveAdmins: async (except) => users.filter((u) => u.role === 'admin' && !u.disabled && u.id !== except).length,
      recordFailedLogin: async (id, n, until) => { const u = users.find((x) => x.id === id)!; u.failedLogins = n; u.lockedUntil = until; },
      recordSuccessfulLogin: async (id, at) => { const u = users.find((x) => x.id === id)!; u.failedLogins = 0; u.lockedUntil = null; u.lastLoginAt = at; },
      setPassword: async (id, hash, must) => { const u = users.find((x) => x.id === id)!; u.passwordHash = hash; u.mustChangePassword = must; u.failedLogins = 0; u.lockedUntil = null; },
    },
    tokens: {
      create: async (t) => { tokens.push({ ...t, lastUsedAt: null, createdAt: new Date().toISOString() }); },
      findActor: async (id, now) => {
        const t = tokens.find((x) => x.id === id);
        const u = t && users.find((x) => x.id === t.userId);
        if (!t || !u || u.disabled) return null;
        if (t.expiresAt && Date.parse(t.expiresAt) < now.getTime()) { tokens.splice(tokens.indexOf(t), 1); return null; }
        return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword, tokenId: t.id, tokenKind: t.kind, lastUsedAt: t.lastUsedAt };
      },
      touch: async (id, at) => { const t = tokens.find((x) => x.id === id); if (t) t.lastUsedAt = at; },
      delete: async (id) => { const i = tokens.findIndex((x) => x.id === id); if (i >= 0) tokens.splice(i, 1); },
      deleteForUser: async (uid, o = {}) => {
        for (let i = tokens.length - 1; i >= 0; i--) {
          const t = tokens[i]!;
          if (t.userId === uid && (!o.kind || t.kind === o.kind) && t.id !== o.exceptId) tokens.splice(i, 1);
        }
      },
      listApiTokens: async (uid) => tokens.filter((t) => t.kind === 'api' && (uid === undefined || t.userId === uid))
        .map((t): ApiTokenInfo => ({ id: t.id, name: t.name, hint: t.hint, lastUsedAt: t.lastUsedAt, createdAt: t.createdAt })),
      deleteApiToken: async (id, uid) => {
        const i = tokens.findIndex((t) => t.id === id && t.kind === 'api' && (uid === undefined || t.userId === uid));
        if (i < 0) return false;
        tokens.splice(i, 1);
        return true;
      },
    },
    timeCategories: {
      list: async () => [...cats],
      usage: async () => {
        const m = new Map<number, number>();
        for (const w of weeks.values()) for (const s of w) for (const c of s?.categoryIds ?? []) m.set(c, (m.get(c) ?? 0) + 1);
        return m;
      },
      usageOf: async (id) => [...weeks.values()].flat().filter((s) => s?.categoryIds.includes(id)).length,
      create: async (c) => { const id = Math.max(0, ...cats.map((x) => x.id)) + 1; cats.push({ ...c, id, sort: cats.length + 1 }); return id; },
      update: async (id, p) => { const c = cats.find((x) => x.id === id); if (!c) return false; Object.assign(c, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))); return true; },
      delete: async (id) => { const i = cats.findIndex((x) => x.id === id); if (i < 0) return false; cats.splice(i, 1); return true; },
    },
    courseCategories: {
      list: async (): Promise<CourseCategory[]> => [],
      usageOf: async () => 0,
      create: notInMemory, update: notInMemory, delete: notInMemory,
    },
    // Course storage is exercised against SQLite in test/courses.test.ts; here it is just empty.
    packs: { list: async () => [], findById: async () => null, create: notInMemory, update: notInMemory, delete: notInMemory, nextOrder: async () => 1 },
    courses: {
      listSummaries: async () => [], findById: async () => null, lessons: async () => [], exercises: async () => [],
      findLesson: async () => null, findExercise: async () => null, create: notInMemory, replace: notInMemory, patch: notInMemory, delete: notInMemory,
    },
    progress: {
      completedLessonIds: async () => new Set(), byCourse: async () => new Map(), setCompleted: notInMemory,
      addAttempt: notInMemory, latestAttempts: async () => new Map(), othersLatest: async () => [],
    },
    schedules: {
      loadWeek: async (uid) => weekOf(uid).slice(),
      saveCells: async (uid, cells: { weekday: number; hour: number; slot: Slot | null }[]) => {
        const w = weekOf(uid).slice();
        for (const c of cells) w[slotIndex(c.weekday, c.hour)] = c.slot;
        weeks.set(uid, w);
      },
      loadTargets: async (uid) => ({ ...(targets.get(uid) ?? {}) }),
      saveTargets: async (uid, t) => { targets.set(uid, { ...t }); },
    },
    oauth: {
      createClient: notInMemory, findClient: async () => null, saveCode: notInMemory, takeCode: async () => null,
      createGrant: notInMemory, findGrantByRefresh: async () => null, findGrantByAccessToken: async () => null, rotateGrant: notInMemory,
    },
    routines: {
      listItems: async () => [], findItem: async () => null, createItem: notInMemory, updateItem: notInMemory, patchItem: notInMemory,
      deleteItem: notInMemory, itemUsage: async () => 0, listPlans: async () => [], findPlan: async () => null, entries: async () => [],
      allEntries: async () => [], createPlan: notInMemory, replacePlan: notInMemory, patchPlan: notInMemory, deletePlan: notInMemory,
      assignments: async () => [], setAssignments: notInMemory,
    },
    privacy: {
      load: async (uid) => ({ ...(privacy.get(uid) ?? DEFAULT_PRIVACY) }),
      save: async (uid, p) => { privacy.set(uid, { ...p }); },
    },
  };
}

const notInMemory = async (): Promise<never> => { throw new Error('not implemented in memory repositories'); };

export const DEFAULT_CATS = [
  { id: 1, nameTh: 'พักผ่อน', nameEn: 'Rest', color: '#C1E6FF' },
  { id: 2, nameTh: 'ทำงาน', nameEn: 'Work', color: '#C4ECD0' },
  { id: 3, nameTh: 'project เสริม', nameEn: 'Side project', color: '#E7DEF8' },
];
