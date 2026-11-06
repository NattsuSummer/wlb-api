import type { Course, CourseSummary, Exercise, ExerciseData, Lesson, Pack } from '../../domain/course';
import type { Attempt, CourseRepository, CourseWrite, NewPack, PackRepository, ProgressRepository } from '../interfaces';
import type { D1Database, D1PreparedStatement } from './db';

const parse = <T>(s: unknown, fallback: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return fallback; }
};

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toPack = (r: Row): Pack => ({
  id: Number(r.id), title: String(r.title), description: String(r.description), categoryId: num(r.category_id),
  coverUrl: (r.cover_url as string) ?? null, createdBy: num(r.created_by), createdAt: String(r.created_at),
});

const toCourse = (r: Row): Course => ({
  id: Number(r.id), packId: num(r.pack_id), orderInPack: num(r.order_in_pack), title: String(r.title), description: String(r.description),
  categoryId: num(r.category_id), level: r.level as Course['level'], visibility: r.visibility as Course['visibility'], status: r.status as Course['status'],
  coverUrl: (r.cover_url as string) ?? null, createdBy: num(r.created_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

const toLesson = (r: Row): Lesson => ({
  id: Number(r.id), courseId: Number(r.course_id), sort: Number(r.sort), title: String(r.title), minutes: num(r.minutes),
  contentMd: String(r.content_md), links: parse(r.links_json, []), images: parse(r.images_json, []),
});

const toExercise = (r: Row): Exercise => {
  const data = { ...parse<Record<string, unknown>>(r.data_json, {}), type: r.type } as ExerciseData;
  return { id: Number(r.id), lessonId: Number(r.lesson_id), sort: Number(r.sort), prompt: String(r.prompt), data };
};

/** Everything except `type` goes in data_json. */
const dataJson = (d: ExerciseData) => {
  const { type, ...rest } = d;
  return JSON.stringify(rest);
};

const PACK_COLUMNS: Record<string, string> = { title: 'title', description: 'description', categoryId: 'category_id', coverUrl: 'cover_url' };

export class D1PackRepository implements PackRepository {
  constructor(private db: D1Database) {}

  async list() {
    return (await this.db.prepare('SELECT * FROM packs ORDER BY title COLLATE NOCASE, id').all<Row>()).results.map(toPack);
  }

  async findById(id: number) {
    const r = await this.db.prepare('SELECT * FROM packs WHERE id = ?').bind(id).first<Row>();
    return r ? toPack(r) : null;
  }

  async create(p: NewPack) {
    const res = await this.db
      .prepare('INSERT INTO packs (title, description, category_id, cover_url, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(p.title, p.description, p.categoryId, p.coverUrl, p.createdBy)
      .run();
    return Number(res.meta.last_row_id);
  }

  async update(id: number, patch: Partial<Omit<NewPack, 'createdBy'>>) {
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) return true;
    const res = await this.db
      .prepare(`UPDATE packs SET ${keys.map((k) => `${PACK_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => (patch as Record<string, unknown>)[k]), id)
      .run();
    return !!res.meta.changes;
  }

  async delete(id: number) {
    const [, res] = await this.db.batch([
      this.db.prepare('UPDATE courses SET pack_id = NULL, order_in_pack = NULL WHERE pack_id = ?').bind(id),
      this.db.prepare('DELETE FROM packs WHERE id = ?').bind(id),
    ]);
    return !!res!.meta.changes;
  }

  async nextOrder(packId: number) {
    const r = await this.db.prepare('SELECT COALESCE(MAX(order_in_pack), 0) + 1 AS n FROM courses WHERE pack_id = ?').bind(packId).first<{ n: number }>();
    return r?.n ?? 1;
  }
}

export class D1CourseRepository implements CourseRepository {
  constructor(private db: D1Database) {}

  async listSummaries(): Promise<CourseSummary[]> {
    const rows = await this.db.prepare(`
      SELECT c.*, u.display_name AS creator_name,
             (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
             (SELECT COALESCE(SUM(l.minutes), 0) FROM lessons l WHERE l.course_id = c.id) AS minutes
      FROM courses c LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.pack_id IS NULL, c.pack_id, c.order_in_pack, c.created_at DESC`).all<Row>();
    return rows.results.map((r) => ({ ...toCourse(r), lessonCount: Number(r.lesson_count), minutes: Number(r.minutes), creatorName: (r.creator_name as string) ?? null }));
  }

  async findById(id: number) {
    const r = await this.db.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first<Row>();
    return r ? toCourse(r) : null;
  }

  async lessons(courseId: number) {
    return (await this.db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort, id').bind(courseId).all<Row>()).results.map(toLesson);
  }

  async exercises(courseId: number) {
    const rows = await this.db
      .prepare('SELECT e.* FROM exercises e JOIN lessons l ON l.id = e.lesson_id WHERE l.course_id = ? ORDER BY l.sort, e.sort, e.id')
      .bind(courseId)
      .all<Row>();
    return rows.results.map(toExercise);
  }

  async findLesson(lessonId: number) {
    const r = await this.db.prepare('SELECT * FROM lessons WHERE id = ?').bind(lessonId).first<Row>();
    return r ? toLesson(r) : null;
  }

  async findExercise(exerciseId: number) {
    const r = await this.db
      .prepare('SELECT e.*, l.course_id FROM exercises e JOIN lessons l ON l.id = e.lesson_id WHERE e.id = ?')
      .bind(exerciseId)
      .first<Row>();
    return r ? { ...toExercise(r), courseId: Number(r.course_id) } : null;
  }

  async create(w: CourseWrite & { createdBy: number }) {
    const d = w.draft;
    // Inside one batch (= one transaction) the new course is the row with the highest id.
    const CID = '(SELECT MAX(id) FROM courses)';
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('INSERT INTO courses (pack_id, order_in_pack, title, description, category_id, level, visibility, status, cover_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(w.packId, w.orderInPack, d.title, d.description, d.categoryId, d.level, d.visibility, w.status, d.coverUrl, w.createdBy),
    ];
    d.lessons.forEach((l, i) => {
      stmts.push(this.insertLesson(CID, i, l));
      l.exercises.forEach((x, j) => stmts.push(this.insertExercise(`(SELECT id FROM lessons WHERE course_id = ${CID} AND sort = ${i})`, j, x)));
    });
    const res = await this.db.batch(stmts);
    return Number(res[0]!.meta.last_row_id);
  }

  async replace(id: number, w: CourseWrite) {
    const d = w.draft;
    const oldLessons = await this.lessons(id);
    const oldExercises = await this.exercises(id);
    const oldLessonIds = new Set(oldLessons.map((l) => l.id));
    const keptLessons = new Set(d.lessons.filter((l) => l.id !== undefined && oldLessonIds.has(l.id)).map((l) => l.id!));

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(`UPDATE courses SET pack_id = ?, order_in_pack = ?, title = ?, description = ?, category_id = ?, level = ?, visibility = ?, status = ?, cover_url = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .bind(w.packId, w.orderInPack, d.title, d.description, d.categoryId, d.level, d.visibility, w.status, d.coverUrl, id),
    ];
    for (const l of oldLessons) if (!keptLessons.has(l.id)) stmts.push(this.db.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id));
    // Park kept lessons on negative sorts first so new lessons can be found by (course_id, sort) unambiguously.
    d.lessons.forEach((l, i) => {
      if (l.id !== undefined && keptLessons.has(l.id)) {
        stmts.push(this.db
          .prepare('UPDATE lessons SET sort = ?, title = ?, minutes = ?, content_md = ?, links_json = ?, images_json = ? WHERE id = ? AND course_id = ?')
          .bind(-1 - i, l.title, l.minutes, l.contentMd, JSON.stringify(l.links), JSON.stringify(l.images), l.id, id));
      } else stmts.push(this.insertLesson(String(id), i, l));
    });
    d.lessons.forEach((l, i) => {
      const kept = l.id !== undefined && keptLessons.has(l.id);
      const lessonRef = kept ? String(l.id) : `(SELECT id FROM lessons WHERE course_id = ${id} AND sort = ${i})`;
      if (kept) {
        const keepIds = new Set(l.exercises.map((x) => x.id).filter((x) => x !== undefined));
        for (const x of oldExercises) if (x.lessonId === l.id && !keepIds.has(x.id)) stmts.push(this.db.prepare('DELETE FROM exercises WHERE id = ?').bind(x.id));
      }
      l.exercises.forEach((x, j) => {
        const own = kept && x.id !== undefined && oldExercises.some((o) => o.id === x.id && o.lessonId === l.id);
        if (own) {
          stmts.push(this.db.prepare('UPDATE exercises SET sort = ?, type = ?, prompt = ?, data_json = ? WHERE id = ?').bind(j, x.data.type, x.prompt, dataJson(x.data), x.id));
        } else stmts.push(this.insertExercise(lessonRef, j, x));
      });
    });
    d.lessons.forEach((l, i) => {
      if (l.id !== undefined && keptLessons.has(l.id)) stmts.push(this.db.prepare('UPDATE lessons SET sort = ? WHERE id = ?').bind(i, l.id));
    });
    await this.db.batch(stmts);
  }

  async patch(id: number, p: { visibility?: string; status?: string; packId?: number | null; orderInPack?: number | null }) {
    const cols: Record<string, string> = { visibility: 'visibility', status: 'status', packId: 'pack_id', orderInPack: 'order_in_pack' };
    const keys = Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) return;
    await this.db
      .prepare(`UPDATE courses SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .bind(...keys.map((k) => (p as Record<string, unknown>)[k]), id)
      .run();
  }

  async delete(id: number) {
    const res = await this.db.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
    return !!res.meta.changes;
  }

  private insertLesson(courseRef: string, sort: number, l: CourseWrite['draft']['lessons'][number]) {
    return this.db
      .prepare(`INSERT INTO lessons (course_id, sort, title, minutes, content_md, links_json, images_json) VALUES (${courseRef}, ?, ?, ?, ?, ?, ?)`)
      .bind(sort, l.title, l.minutes, l.contentMd, JSON.stringify(l.links), JSON.stringify(l.images));
  }

  private insertExercise(lessonRef: string, sort: number, x: CourseWrite['draft']['lessons'][number]['exercises'][number]) {
    return this.db
      .prepare(`INSERT INTO exercises (lesson_id, sort, type, prompt, data_json) VALUES (${lessonRef}, ?, ?, ?, ?)`)
      .bind(sort, x.data.type, x.prompt, dataJson(x.data));
  }
}

export class D1ProgressRepository implements ProgressRepository {
  constructor(private db: D1Database) {}

  async completedLessonIds(userId: number, courseId?: number) {
    const rows = courseId === undefined
      ? await this.db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ? AND completed_at IS NOT NULL').bind(userId).all<{ lesson_id: number }>()
      : await this.db
        .prepare('SELECT p.lesson_id FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = ? AND l.course_id = ? AND p.completed_at IS NOT NULL')
        .bind(userId, courseId)
        .all<{ lesson_id: number }>();
    return new Set(rows.results.map((r) => r.lesson_id));
  }

  async byCourse(userId: number) {
    const rows = await this.db.prepare(`
      SELECT course_id, SUM(done) AS done, MAX(at) AS last_at FROM (
        SELECT l.course_id, 1 AS done, p.completed_at AS at FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
          WHERE p.user_id = ?1 AND p.completed_at IS NOT NULL
        UNION ALL
        SELECT l.course_id, 0, a.created_at FROM exercise_attempts a JOIN exercises e ON e.id = a.exercise_id JOIN lessons l ON l.id = e.lesson_id
          WHERE a.user_id = ?1
      ) GROUP BY course_id`).bind(userId).all<{ course_id: number; done: number; last_at: string }>();
    return new Map(rows.results.map((r) => [r.course_id, { done: Number(r.done), lastAt: r.last_at }]));
  }

  async setCompleted(userId: number, lessonId: number, at: string | null) {
    if (at === null) {
      await this.db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').bind(userId, lessonId).run();
      return;
    }
    await this.db
      .prepare('INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?) ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed_at = excluded.completed_at')
      .bind(userId, lessonId, at)
      .run();
  }

  async addAttempt(a: Attempt) {
    await this.db
      .prepare('INSERT INTO exercise_attempts (user_id, exercise_id, answer_json, is_correct, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(a.userId, a.exerciseId, JSON.stringify(a.answer), a.isCorrect === null ? null : Number(a.isCorrect), a.createdAt)
      .run();
  }

  async latestAttempts(userId: number, exerciseIds: number[]) {
    const out = new Map<number, Attempt>();
    if (!exerciseIds.length) return out;
    const rows = await this.db
      .prepare(`SELECT * FROM exercise_attempts WHERE user_id = ? AND exercise_id IN (${exerciseIds.map(() => '?').join(',')}) ORDER BY id`)
      .bind(userId, ...exerciseIds)
      .all<Row>();
    for (const r of rows.results) out.set(Number(r.exercise_id), toAttempt(r)); // later rows win
    return out;
  }

  async othersLatest(exerciseIds: number[], exceptUserId: number) {
    if (!exerciseIds.length) return [];
    const rows = await this.db
      .prepare(`SELECT a.* FROM exercise_attempts a WHERE a.user_id <> ? AND a.exercise_id IN (${exerciseIds.map(() => '?').join(',')})
                AND a.id = (SELECT MAX(b.id) FROM exercise_attempts b WHERE b.user_id = a.user_id AND b.exercise_id = a.exercise_id)
                ORDER BY a.created_at DESC`)
      .bind(exceptUserId, ...exerciseIds)
      .all<Row>();
    return rows.results.map(toAttempt);
  }
}

const toAttempt = (r: Row): Attempt => ({
  exerciseId: Number(r.exercise_id), userId: Number(r.user_id), answer: parse(r.answer_json, null),
  isCorrect: r.is_correct === null ? null : !!r.is_correct, createdAt: String(r.created_at),
});
