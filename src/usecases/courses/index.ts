// Course use cases: catalog, course + lesson pages, progress, exercises, import/export, packs.
import {
  answerProblem, canEditCourse, canViewCourse, courseState, grade, inCatalog, percent, publicExerciseData, skippedCourses, skippedLessons,
  toImportJson, validateCourseDraft, type Answer, type Course, type CourseDraft, type CourseStatus, type CourseSummary, type Visibility,
} from '../../domain/course';
import { conflictError, forbiddenError, notFoundError, validationError } from '../../domain/errors';
import { importGuideMarkdown } from '../../domain/import-guide';
import { visibility as privacyLevel } from '../../domain/privacy';
import { publicUser, type Actor } from '../../domain/user';
import type { Deps } from '../deps';
import { requireAdmin } from '../users';

type ProgressMap = Map<number, { done: number; lastAt: string }>;

/** A course as shown on cards: summary + my progress + what I may do with it. */
export function courseCard(c: CourseSummary, actor: Actor, progress: ProgressMap) {
  const p = progress.get(c.id);
  const done = Math.min(p?.done ?? 0, c.lessonCount);
  return {
    ...c,
    progress: { done, total: c.lessonCount, percent: percent(done, c.lessonCount), state: courseState(done, c.lessonCount), lastAt: p?.lastAt ?? null },
    mine: c.createdBy === actor.id,
    canEdit: canEditCourse(c, actor),
  };
}
export type CourseCard = ReturnType<typeof courseCard>;

abstract class CourseUseCase {
  constructor(protected d: Deps) {}

  /** Missing and not-visible look the same (404), so private courses do not leak. */
  protected async viewable(courseId: number, actor: Actor): Promise<Course> {
    const c = await this.d.repos.courses.findById(courseId);
    if (!c || !canViewCourse(c, actor)) throw notFoundError('Course not found');
    return c;
  }

  protected async editable(courseId: number, actor: Actor): Promise<Course> {
    const c = await this.viewable(courseId, actor);
    if (!canEditCourse(c, actor)) throw forbiddenError('Only the creator or an admin can change this course');
    return c;
  }

  protected async validate(input: unknown) {
    const [categories, packs] = await Promise.all([this.d.repos.courseCategories.list(), this.d.repos.packs.list()]);
    return validateCourseDraft(input, categories, packs);
  }

  protected async validOrThrow(input: unknown) {
    const v = await this.validate(input);
    if (!v.draft) throw validationError(`Course has ${v.errors.length} problem(s)`, { errors: v.errors, warnings: v.warnings }, 'invalid_course');
    return { draft: v.draft, warnings: v.warnings };
  }

  /** Turn the draft's pack reference into ids, creating a new pack if needed. */
  protected async resolvePack(draft: CourseDraft, actor: Actor, current?: Course) {
    if (!draft.pack) return { packId: null, orderInPack: null };
    let packId = draft.pack.id ?? null;
    if (packId === null) {
      packId = await this.d.repos.packs.create({ title: draft.pack.title!, description: '', categoryId: draft.categoryId, coverUrl: null, createdBy: actor.id });
    }
    const keep = current && current.packId === packId && current.orderInPack !== null;
    const orderInPack = draft.pack.order ?? (keep ? current!.orderInPack : await this.d.repos.packs.nextOrder(packId));
    return { packId, orderInPack };
  }
}

export class ListCatalogUseCase extends CourseUseCase {
  async execute(actor: Actor) {
    const [categories, packs, all, progress] = await Promise.all([
      this.d.repos.courseCategories.list(), this.d.repos.packs.list(), this.d.repos.courses.listSummaries(), this.d.repos.progress.byCourse(actor.id),
    ]);
    const cards = all.filter((c) => inCatalog(c, actor)).map((c) => courseCard(c, actor, progress));
    const byPack = new Map<number, CourseCard[]>();
    for (const c of cards) if (c.packId !== null) byPack.set(c.packId, [...(byPack.get(c.packId) ?? []), c]);
    return {
      categories,
      packs: packs
        .filter((p) => byPack.has(p.id) || p.createdBy === actor.id)
        .map((p) => {
          const courses = (byPack.get(p.id) ?? []).sort((a, b) => (a.orderInPack ?? 0) - (b.orderInPack ?? 0));
          const done = courses.filter((c) => c.progress.state === 'done').length;
          return { ...p, courses, progress: { done, total: courses.length, percent: percent(done, courses.length) }, canEdit: p.createdBy === actor.id || actor.role === 'admin' };
        }),
      singles: cards.filter((c) => c.packId === null),
      inProgress: cards.filter((c) => c.progress.state === 'in_progress').sort((a, b) => (b.progress.lastAt ?? '').localeCompare(a.progress.lastAt ?? '')),
    };
  }
}

/** Admin: every course, including others' private ones and drafts. */
export class AdminListCoursesUseCase extends CourseUseCase {
  async execute(actor: Actor) {
    requireAdmin(actor);
    const progress = await this.d.repos.progress.byCourse(actor.id);
    return { courses: (await this.d.repos.courses.listSummaries()).map((c) => courseCard(c, actor, progress)) };
  }
}

export class GetCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, courseId: number) {
    const course = await this.viewable(courseId, actor);
    const [lessons, exercises, completed, progress, all, categories] = await Promise.all([
      this.d.repos.courses.lessons(courseId), this.d.repos.courses.exercises(courseId), this.d.repos.progress.completedLessonIds(actor.id, courseId),
      this.d.repos.progress.byCourse(actor.id), this.d.repos.courses.listSummaries(), this.d.repos.courseCategories.list(),
    ]);
    const summary = all.find((c) => c.id === courseId)!;
    let pack = null;
    let skipped: { id: number; title: string }[] = [];
    if (course.packId !== null) {
      const p = await this.d.repos.packs.findById(course.packId);
      const siblings = all.filter((c) => c.packId === course.packId && inCatalog(c, actor)).map((c) => courseCard(c, actor, progress));
      if (p) pack = { ...p, courses: siblings.map((c) => ({ id: c.id, title: c.title, orderInPack: c.orderInPack, state: c.progress.state, percent: c.progress.percent })) };
      skipped = skippedCourses(siblings.map((c) => ({ id: c.id, title: c.title, orderInPack: c.orderInPack, state: c.progress.state })), courseId)
        .map(({ id, title }) => ({ id, title }));
    }
    const firstOpen = lessons.find((l) => !completed.has(l.id));
    return {
      course: courseCard(summary, actor, progress),
      category: categories.find((c) => c.id === course.categoryId) ?? null,
      lessons: lessons.map((l) => ({
        id: l.id, sort: l.sort, title: l.title, minutes: l.minutes, completed: completed.has(l.id),
        exerciseCount: exercises.filter((x) => x.lessonId === l.id).length,
      })),
      nextLessonId: firstOpen?.id ?? lessons[0]?.id ?? null,
      pack,
      skippedCourses: skipped,
    };
  }
}

export class GetLessonUseCase extends CourseUseCase {
  async execute(actor: Actor, lessonId: number) {
    const lesson = await this.d.repos.courses.findLesson(lessonId);
    if (!lesson) throw notFoundError('Lesson not found');
    const course = await this.viewable(lesson.courseId, actor);
    const [lessons, allExercises, completed] = await Promise.all([
      this.d.repos.courses.lessons(course.id), this.d.repos.courses.exercises(course.id), this.d.repos.progress.completedLessonIds(actor.id, course.id),
    ]);
    const exercises = allExercises.filter((x) => x.lessonId === lessonId);
    const attempts = await this.d.repos.progress.latestAttempts(actor.id, exercises.map((x) => x.id));
    const i = lessons.findIndex((l) => l.id === lessonId);

    // Other members' written answers, if they share them (privacy "answers").
    const textIds = exercises.filter((x) => x.data.type === 'text').map((x) => x.id);
    const others = [];
    if (textIds.length) {
      const users = new Map((await this.d.repos.users.list()).map((u) => [u.id, u]));
      for (const a of await this.d.repos.progress.othersLatest(textIds, actor.id)) {
        const u = users.get(a.userId);
        if (!u) continue;
        if (privacyLevel(await this.d.repos.privacy.load(u.id), 'answers', false) === 'hide') continue;
        others.push({ exerciseId: a.exerciseId, user: publicUser(u), answer: a.answer, createdAt: a.createdAt });
      }
    }

    return {
      course: { id: course.id, title: course.title, packId: course.packId, canEdit: canEditCourse(course, actor) },
      lesson,
      completed: completed.has(lessonId),
      exercises: exercises.map((x) => {
        const mine = attempts.get(x.id) ?? null;
        return { id: x.id, sort: x.sort, prompt: x.prompt, data: publicExerciseData(x.data, !!mine), myAttempt: mine && { answer: mine.answer, isCorrect: mine.isCorrect, createdAt: mine.createdAt } };
      }),
      othersAnswers: others,
      skipped: skippedLessons(lessons, lessonId, completed).map((l) => ({ id: l.id, title: l.title })),
      outline: lessons.map((l) => ({ id: l.id, title: l.title, minutes: l.minutes, completed: completed.has(l.id) })),
      prevId: lessons[i - 1]?.id ?? null,
      nextId: lessons[i + 1]?.id ?? null,
      progress: { done: completed.size, total: lessons.length, percent: percent(completed.size, lessons.length) },
    };
  }
}

export class SetLessonCompleteUseCase extends CourseUseCase {
  async execute(actor: Actor, lessonId: number, done: boolean) {
    const lesson = await this.d.repos.courses.findLesson(lessonId);
    if (!lesson) throw notFoundError('Lesson not found');
    await this.viewable(lesson.courseId, actor);
    await this.d.repos.progress.setCompleted(actor.id, lessonId, done ? this.d.clock.now().toISOString() : null);
    const [lessons, completed] = await Promise.all([this.d.repos.courses.lessons(lesson.courseId), this.d.repos.progress.completedLessonIds(actor.id, lesson.courseId)]);
    return { completed: done, progress: { done: completed.size, total: lessons.length, percent: percent(completed.size, lessons.length), state: courseState(completed.size, lessons.length) } };
  }
}

export class AttemptExerciseUseCase extends CourseUseCase {
  async execute(actor: Actor, exerciseId: number, answer: unknown) {
    const x = await this.d.repos.courses.findExercise(exerciseId);
    if (!x) throw notFoundError('Exercise not found');
    await this.viewable(x.courseId, actor);
    const problem = answerProblem(x.data, answer);
    if (problem) throw validationError(problem);
    const isCorrect = grade(x.data, answer as Answer);
    await this.d.repos.progress.addAttempt({ userId: actor.id, exerciseId, answer, isCorrect, createdAt: this.d.clock.now().toISOString() });
    return { isCorrect, data: x.data };
  }
}

export class ValidateCourseUseCase extends CourseUseCase {
  async execute(_actor: Actor, input: unknown) {
    return this.validate(input);
  }
}

/** Create from import JSON. Courses sent with an API token (scripts / AI) start as drafts unless told otherwise. */
export class ImportCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, input: unknown, opts: { status?: CourseStatus } = {}) {
    const { draft, warnings } = await this.validOrThrow(input);
    const status = opts.status ?? (actor.tokenKind === 'api' ? 'draft' : 'published');
    const { packId, orderInPack } = await this.resolvePack(draft, actor);
    const id = await this.d.repos.courses.create({ draft, packId, orderInPack, status, createdBy: actor.id });
    return { id, status, warnings };
  }
}

export class UpdateCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, courseId: number, input: unknown, opts: { status?: CourseStatus } = {}) {
    const current = await this.editable(courseId, actor);
    const { draft, warnings } = await this.validOrThrow(input);
    const { packId, orderInPack } = await this.resolvePack(draft, actor, current);
    await this.d.repos.courses.replace(courseId, { draft, packId, orderInPack, status: opts.status ?? current.status });
    return { id: courseId, warnings };
  }
}

export class PatchCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, courseId: number, patch: { visibility?: Visibility; status?: CourseStatus; packId?: number | null; orderInPack?: number | null }) {
    await this.editable(courseId, actor);
    if (patch.packId !== undefined && patch.packId !== null && !(await this.d.repos.packs.findById(patch.packId))) throw notFoundError('Pack not found');
    if (patch.packId === null) patch.orderInPack = null;
    else if (patch.packId !== undefined && patch.orderInPack === undefined) patch.orderInPack = await this.d.repos.packs.nextOrder(patch.packId);
    await this.d.repos.courses.patch(courseId, patch);
    return { ok: true };
  }
}

export class DeleteCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, courseId: number) {
    await this.editable(courseId, actor);
    await this.d.repos.courses.delete(courseId);
    return { ok: true };
  }
}

export class ExportCourseUseCase extends CourseUseCase {
  async execute(actor: Actor, courseId: number) {
    const c = await this.viewable(courseId, actor);
    const [lessons, exercises, categories] = await Promise.all([
      this.d.repos.courses.lessons(courseId), this.d.repos.courses.exercises(courseId), this.d.repos.courseCategories.list(),
    ]);
    const pack = c.packId === null ? null : await this.d.repos.packs.findById(c.packId);
    return toImportJson(c, lessons.map((l) => ({ ...l, exercises: exercises.filter((x) => x.lessonId === l.id) })), categories, pack);
  }
}

export class GetImportGuideUseCase {
  constructor(private d: Deps) {}
  async execute() {
    return importGuideMarkdown(await this.d.repos.courseCategories.list());
  }
}

// ---------- packs ----------
export class ListPacksUseCase {
  constructor(private d: Deps) {}
  async execute() {
    return { packs: await this.d.repos.packs.list() };
  }
}

export class CreatePackUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, input: { title: string; description?: string; categoryId?: number | null; coverUrl?: string | null }) {
    const packs = await this.d.repos.packs.list();
    if (packs.some((p) => p.title.toLowerCase() === input.title.toLowerCase())) throw conflictError('pack_exists', 'A pack with this title already exists');
    await this.checkCategory(input.categoryId);
    const id = await this.d.repos.packs.create({ title: input.title, description: input.description ?? '', categoryId: input.categoryId ?? null, coverUrl: input.coverUrl ?? null, createdBy: actor.id });
    return { id };
  }
  async checkCategory(id: number | null | undefined) {
    if (id !== undefined && id !== null && !(await this.d.repos.courseCategories.list()).some((c) => c.id === id)) throw validationError('Unknown course category');
  }
}

export class UpdatePackUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number, patch: { title?: string; description?: string; categoryId?: number | null; coverUrl?: string | null }) {
    const p = await this.d.repos.packs.findById(id);
    if (!p) throw notFoundError('Pack not found');
    if (p.createdBy !== actor.id && actor.role !== 'admin') throw forbiddenError('Only the creator or an admin can change this pack');
    await new CreatePackUseCase(this.d).checkCategory(patch.categoryId);
    await this.d.repos.packs.update(id, patch);
    return { ok: true };
  }
}

export class DeletePackUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number) {
    const p = await this.d.repos.packs.findById(id);
    if (!p) throw notFoundError('Pack not found');
    if (p.createdBy !== actor.id && actor.role !== 'admin') throw forbiddenError('Only the creator or an admin can delete this pack');
    await this.d.repos.packs.delete(id);
    return { ok: true };
  }
}

// ---------- course categories (admin) ----------
const TINTS = ['r', 'w', 'p', 'f', 'o']; // same letters as the time categories' colours

export class CreateCourseCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, input: { nameTh: string; nameEn?: string; icon?: string; tint?: string }) {
    requireAdmin(actor);
    if (input.tint !== undefined && !TINTS.includes(input.tint)) throw validationError(`tint must be one of: ${TINTS.join(', ')}`);
    const id = await this.d.repos.courseCategories.create({ nameTh: input.nameTh, nameEn: input.nameEn || input.nameTh, icon: input.icon || 'book', tint: input.tint || 'r' });
    return { id };
  }
}

export class UpdateCourseCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number, patch: { nameTh?: string; nameEn?: string; icon?: string; tint?: string; sort?: number }) {
    requireAdmin(actor);
    if (patch.tint !== undefined && !TINTS.includes(patch.tint)) throw validationError(`tint must be one of: ${TINTS.join(', ')}`);
    if (!(await this.d.repos.courseCategories.update(id, patch))) throw notFoundError('Category not found');
    return { ok: true };
  }
}

export class DeleteCourseCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number) {
    requireAdmin(actor);
    const used = await this.d.repos.courseCategories.usageOf(id);
    if (used > 0) throw conflictError('category_in_use', `Category is used by ${used} course(s) or pack(s)`, { used });
    if (!(await this.d.repos.courseCategories.delete(id))) throw notFoundError('Category not found');
    return { ok: true };
  }
}
