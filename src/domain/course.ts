// Courses: types and pure rules (import validation, visibility, order warnings, grading). No I/O here.
import type { CourseCategory } from './category';

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const VISIBILITIES = ['group', 'private'] as const;
export const STATUSES = ['published', 'draft'] as const;
export const EXERCISE_TYPES = ['mcq', 'checklist', 'text'] as const;
export type Level = (typeof LEVELS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type CourseStatus = (typeof STATUSES)[number];
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export interface Link { title: string; url: string }
export interface Image { url: string; alt: string }

export type ExerciseData =
  | { type: 'mcq'; choices: string[]; answer: number }
  | { type: 'checklist'; items: string[] }
  | { type: 'text'; sample: string };

export interface Exercise { id: number; lessonId: number; sort: number; prompt: string; data: ExerciseData }

export interface Lesson {
  id: number;
  courseId: number;
  sort: number;
  title: string;
  minutes: number | null;
  contentMd: string;
  links: Link[];
  images: Image[];
}

export interface Course {
  id: number;
  packId: number | null;
  orderInPack: number | null;
  title: string;
  description: string;
  categoryId: number | null;
  level: Level;
  visibility: Visibility;
  status: CourseStatus;
  coverUrl: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseSummary extends Course { lessonCount: number; minutes: number; creatorName: string | null }

export interface Pack {
  id: number;
  title: string;
  description: string;
  categoryId: number | null;
  coverUrl: string | null;
  createdBy: number | null;
  createdAt: string;
}

// ---------- who may see / change what ----------
export interface Viewer { id: number; role: 'admin' | 'member' }

/** Shared courses are for everyone; private courses and drafts only for their creator (and admins, who manage all courses). */
export function canViewCourse(c: Pick<Course, 'visibility' | 'status' | 'createdBy'>, v: Viewer): boolean {
  return c.createdBy === v.id || v.role === 'admin' || (c.visibility === 'group' && c.status === 'published');
}

/** What appears in the catalog: shared + published, plus my own (admins see others' private courses only in the admin list). */
export function inCatalog(c: Pick<Course, 'visibility' | 'status' | 'createdBy'>, v: Viewer): boolean {
  return c.createdBy === v.id || (c.visibility === 'group' && c.status === 'published');
}

export const canEditCourse = (c: Pick<Course, 'createdBy'>, v: Viewer) => c.createdBy === v.id || v.role === 'admin';

// ---------- progress and order ----------
export function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export type CourseState = 'not_started' | 'in_progress' | 'done';
export function courseState(done: number, total: number): CourseState {
  if (done === 0) return 'not_started';
  return total > 0 && done >= total ? 'done' : 'in_progress';
}

/** Lessons before `lessonId` (in order) that are not completed yet — learners may skip, but we warn. */
export function skippedLessons<T extends { id: number; sort: number }>(lessons: T[], lessonId: number, completed: Set<number>): T[] {
  const ordered = [...lessons].sort((a, b) => a.sort - b.sort);
  const i = ordered.findIndex((l) => l.id === lessonId);
  return i < 0 ? [] : ordered.slice(0, i).filter((l) => !completed.has(l.id));
}

/** Courses earlier in the same pack that are not finished yet. */
export function skippedCourses<T extends { id: number; orderInPack: number | null; state: CourseState }>(packCourses: T[], courseId: number): T[] {
  const ordered = [...packCourses].sort((a, b) => (a.orderInPack ?? 0) - (b.orderInPack ?? 0) || a.id - b.id);
  const i = ordered.findIndex((c) => c.id === courseId);
  return i < 0 ? [] : ordered.slice(0, i).filter((c) => c.state !== 'done');
}

// ---------- exercises ----------
export type Answer = number | number[] | string; // mcq: choice index · checklist: checked item indexes · text: free text

/** Returns is_correct: true/false for mcq, null for checklist and text (nothing to grade). */
export function grade(data: ExerciseData, answer: Answer): boolean | null {
  if (data.type === 'mcq') return answer === data.answer;
  return null;
}

export function answerProblem(data: ExerciseData, answer: unknown): string | null {
  if (data.type === 'mcq') return Number.isInteger(answer) && (answer as number) >= 0 && (answer as number) < data.choices.length ? null : 'answer must be a choice index';
  if (data.type === 'checklist') {
    return Array.isArray(answer) && answer.every((x) => Number.isInteger(x) && x >= 0 && x < data.items.length) ? null : 'answer must be a list of item indexes';
  }
  return typeof answer === 'string' && answer.length <= 5000 ? null : 'answer must be text (max 5000 characters)';
}

/** The learner sees mcq answers only after trying. */
export function publicExerciseData(data: ExerciseData, revealed: boolean): ExerciseData | Omit<Extract<ExerciseData, { type: 'mcq' }>, 'answer'> & { answer?: number } {
  if (data.type === 'mcq' && !revealed) return { type: 'mcq', choices: data.choices };
  return data;
}

// ---------- import JSON (the format people and AIs write) ----------
export const LIMITS = { title: 120, description: 2000, lessons: 100, content: 20000, exercises: 30, choices: 8, items: 30, links: 20, images: 20 };

export interface Issue { path: string; message: string }

export interface DraftExercise { id?: number; prompt: string; data: ExerciseData }
export interface DraftLesson { id?: number; title: string; minutes: number | null; contentMd: string; links: Link[]; images: Image[]; exercises: DraftExercise[] }
export interface CourseDraft {
  title: string;
  description: string;
  categoryId: number | null;
  level: Level;
  visibility: Visibility;
  coverUrl: string | null;
  pack: { id?: number; title?: string; order: number | null } | null;
  lessons: DraftLesson[];
}

export interface ValidationResult { errors: Issue[]; warnings: Issue[]; draft: CourseDraft | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

/**
 * Check a course written in the import format and normalise it.
 * Errors block saving; warnings are shown but do not block.
 * `packs` lets a pack be referenced by title; an unknown title creates a new pack (warning).
 */
export function validateCourseDraft(input: unknown, categories: CourseCategory[], packs: Pick<Pack, 'id' | 'title'>[] = []): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  if (!isObj(input)) return { errors: [{ path: '', message: 'Top level must be a JSON object' }], warnings, draft: null };
  const root = isObj(input.course) ? { ...input.course, lessons: input.course.lessons ?? input.lessons } : input; // accept {course:{…}} too

  const text = (v: unknown, path: string, max: number, required: boolean): string => {
    if (v === undefined || v === null || v === '') {
      if (required) err(path, 'is required');
      return '';
    }
    if (typeof v !== 'string') { err(path, 'must be text'); return ''; }
    const s = v.trim();
    if (required && !s) err(path, 'is required');
    if (s.length > max) err(path, `is too long (max ${max} characters)`);
    return s;
  };
  const url = (v: unknown, path: string): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !isUrl(v.trim())) { err(path, 'must be an http(s) URL'); return null; }
    return v.trim();
  };
  const oneOf = <T extends string>(v: unknown, path: string, values: readonly T[], fallback: T): T => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'string' && values.includes(v.toLowerCase() as T)) return v.toLowerCase() as T;
    err(path, `must be one of: ${values.join(', ')}`);
    return fallback;
  };

  const title = text(root.title, 'title', LIMITS.title, true);
  const description = text(root.description, 'description', LIMITS.description, false);
  if (!description) warn('description', 'A short description helps others decide to take the course');
  const level = oneOf(root.level, 'level', LEVELS, 'beginner');
  const visibility = oneOf(root.visibility, 'visibility', VISIBILITIES, 'group');
  const coverUrl = url(root.coverUrl ?? root.cover_url, 'coverUrl');

  // category: id, or name in Thai / English (case-insensitive)
  let categoryId: number | null = null;
  const cat = root.category ?? root.categoryId;
  if (cat === undefined || cat === null || cat === '') warn('category', 'No category: the course will be listed under "Other"');
  else {
    const found = typeof cat === 'number'
      ? categories.find((c) => c.id === cat)
      : typeof cat === 'string' ? categories.find((c) => [c.nameTh, c.nameEn].some((n) => n.toLowerCase() === cat.trim().toLowerCase())) : undefined;
    if (found) categoryId = found.id;
    else err('category', `Unknown category "${String(cat)}". Use one of: ${categories.map((c) => c.nameEn).join(', ')}`);
  }

  // pack: { title | id, order } or just a title string
  let pack: CourseDraft['pack'] = null;
  const rawPack = typeof root.pack === 'string' ? { title: root.pack } : root.pack;
  if (rawPack !== undefined && rawPack !== null) {
    if (!isObj(rawPack)) err('pack', 'must be an object like {"title": "English", "order": 1}');
    else {
      const order = rawPack.order === undefined || rawPack.order === null ? null
        : Number.isInteger(rawPack.order) && (rawPack.order as number) >= 1 ? (rawPack.order as number) : (err('pack.order', 'must be a whole number ≥ 1'), null);
      if (typeof rawPack.id === 'number') {
        if (!packs.some((p) => p.id === rawPack.id)) err('pack.id', 'Unknown pack');
        pack = { id: rawPack.id, order };
      } else {
        const ptitle = text(rawPack.title, 'pack.title', LIMITS.title, true);
        const existing = packs.find((p) => p.title.toLowerCase() === ptitle.toLowerCase());
        if (existing) pack = { id: existing.id, order };
        else if (ptitle) { pack = { title: ptitle, order }; warn('pack.title', `Pack "${ptitle}" does not exist yet and will be created`); }
      }
      if (pack && order === null) warn('pack.order', 'No order in pack: the course will go last');
    }
  }

  const lessons: DraftLesson[] = [];
  if (!Array.isArray(root.lessons) || root.lessons.length === 0) err('lessons', 'A course needs at least one lesson');
  else if (root.lessons.length > LIMITS.lessons) err('lessons', `At most ${LIMITS.lessons} lessons`);
  else {
    const seen = new Set<string>();
    root.lessons.forEach((l: unknown, i: number) => {
      const p = `lessons[${i}]`;
      if (!isObj(l)) { err(p, 'must be an object'); return; }
      const ltitle = text(l.title, `${p}.title`, LIMITS.title, true);
      if (ltitle && seen.has(ltitle.toLowerCase())) warn(`${p}.title`, 'Two lessons have the same title');
      seen.add(ltitle.toLowerCase());
      const content = text(l.content ?? l.contentMd ?? l.content_md, `${p}.content`, LIMITS.content, false);
      let minutes: number | null = null;
      if (l.minutes !== undefined && l.minutes !== null) {
        if (Number.isInteger(l.minutes) && (l.minutes as number) >= 1 && (l.minutes as number) <= 600) minutes = l.minutes as number;
        else err(`${p}.minutes`, 'must be a whole number from 1 to 600');
      }
      const links: Link[] = [];
      if (l.links !== undefined) {
        if (!Array.isArray(l.links)) err(`${p}.links`, 'must be a list');
        else {
          if (l.links.length > LIMITS.links) err(`${p}.links`, `At most ${LIMITS.links} links`);
          l.links.forEach((k: unknown, j: number) => {
            const kp = `${p}.links[${j}]`;
            const o = typeof k === 'string' ? { url: k } : k;
            if (!isObj(o)) { err(kp, 'must be {"title", "url"}'); return; }
            const u = url(o.url, `${kp}.url`);
            if (!u) { if (o.url === undefined) err(`${kp}.url`, 'is required'); return; }
            links.push({ title: text(o.title, `${kp}.title`, LIMITS.title, false) || u, url: u });
          });
        }
      }
      const images: Image[] = [];
      if (l.images !== undefined) {
        if (!Array.isArray(l.images)) err(`${p}.images`, 'must be a list');
        else {
          if (l.images.length > LIMITS.images) err(`${p}.images`, `At most ${LIMITS.images} images`);
          l.images.forEach((k: unknown, j: number) => {
            const kp = `${p}.images[${j}]`;
            const o = typeof k === 'string' ? { url: k } : k;
            if (!isObj(o)) { err(kp, 'must be {"url", "alt"}'); return; }
            const u = url(o.url, `${kp}.url`);
            if (!u) { if (o.url === undefined) err(`${kp}.url`, 'is required'); return; }
            images.push({ url: u, alt: text(o.alt, `${kp}.alt`, 200, false) });
          });
        }
      }
      if (!content && !links.length && !images.length) warn(p, 'Lesson has no content, links or images');

      const exercises: DraftExercise[] = [];
      if (l.exercises !== undefined) {
        if (!Array.isArray(l.exercises)) err(`${p}.exercises`, 'must be a list');
        else {
          if (l.exercises.length > LIMITS.exercises) err(`${p}.exercises`, `At most ${LIMITS.exercises} exercises`);
          l.exercises.forEach((x: unknown, j: number) => {
            const xp = `${p}.exercises[${j}]`;
            if (!isObj(x)) { err(xp, 'must be an object'); return; }
            const prompt = text(x.prompt ?? x.question, `${xp}.prompt`, 1000, true);
            const type = oneOf(x.type, `${xp}.type`, EXERCISE_TYPES, 'text');
            const id = typeof x.id === 'number' ? x.id : undefined;
            if (type === 'mcq') {
              const choices = Array.isArray(x.choices) ? x.choices.map((c: unknown, k: number) => text(c, `${xp}.choices[${k}]`, 300, true)) : [];
              if (choices.length < 2 || choices.length > LIMITS.choices) err(`${xp}.choices`, `needs 2–${LIMITS.choices} choices`);
              const a = x.answer;
              const answer = Number.isInteger(a) ? (a as number) : typeof a === 'string' ? choices.indexOf(a.trim()) : -1;
              if (answer < 0 || answer >= choices.length) err(`${xp}.answer`, 'must be the index (0 = first) or exact text of the correct choice');
              exercises.push({ id, prompt, data: { type, choices, answer: Math.max(0, answer) } });
            } else if (type === 'checklist') {
              const items = Array.isArray(x.items) ? x.items.map((c: unknown, k: number) => text(c, `${xp}.items[${k}]`, 300, true)) : [];
              if (items.length < 1 || items.length > LIMITS.items) err(`${xp}.items`, `needs 1–${LIMITS.items} items`);
              exercises.push({ id, prompt, data: { type, items } });
            } else {
              exercises.push({ id, prompt, data: { type, sample: text(x.sample ?? x.answer, `${xp}.sample`, 2000, false) } });
            }
          });
        }
      }
      lessons.push({ id: typeof l.id === 'number' ? l.id : undefined, title: ltitle, minutes, contentMd: content, links, images, exercises });
    });
    if (lessons.length && lessons.every((l) => l.exercises.length === 0)) warn('lessons', 'No exercises in this course (that is fine, just checking)');
  }

  return { errors, warnings, draft: errors.length ? null : { title, description, categoryId, level, visibility, coverUrl, pack, lessons } };
}

/** The import-format JSON for an existing course (for export / editing). Ids are kept so a re-import updates in place. */
export function toImportJson(c: Course, lessons: (Lesson & { exercises: Exercise[] })[], categories: CourseCategory[], pack: Pack | null) {
  return {
    title: c.title,
    description: c.description,
    category: categories.find((x) => x.id === c.categoryId)?.nameEn ?? null,
    level: c.level,
    visibility: c.visibility,
    ...(c.coverUrl ? { coverUrl: c.coverUrl } : {}),
    ...(pack ? { pack: { title: pack.title, order: c.orderInPack } } : {}),
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      ...(l.minutes ? { minutes: l.minutes } : {}),
      content: l.contentMd,
      ...(l.links.length ? { links: l.links } : {}),
      ...(l.images.length ? { images: l.images } : {}),
      ...(l.exercises.length
        ? { exercises: l.exercises.map((x) => ({ id: x.id, prompt: x.prompt, ...x.data, ...(x.data.type === 'text' && !x.data.sample ? { sample: undefined } : {}) })) }
        : {}),
    })),
  };
}
