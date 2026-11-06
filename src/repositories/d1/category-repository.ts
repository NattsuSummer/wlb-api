import type { CourseCategory, TimeCategory } from '../../domain/category';
import type { CourseCategoryRepository, TimeCategoryRepository } from '../interfaces';
import type { D1Database } from './db';

interface Row { id: number; name_th: string; name_en: string; color: string; sort: number }
const toCat = (r: Row): TimeCategory => ({ id: r.id, nameTh: r.name_th, nameEn: r.name_en, color: r.color, sort: r.sort });

const COLUMNS: Record<string, string> = { nameTh: 'name_th', nameEn: 'name_en', color: 'color', sort: 'sort' };

export class D1TimeCategoryRepository implements TimeCategoryRepository {
  constructor(private db: D1Database) {}

  async list() {
    return (await this.db.prepare('SELECT id, name_th, name_en, color, sort FROM time_categories ORDER BY sort, id').all<Row>()).results.map(toCat);
  }

  async usage() {
    const rows = await this.db.prepare('SELECT category_id, COUNT(*) AS n FROM schedule_slot_categories GROUP BY category_id').all<{ category_id: number; n: number }>();
    return new Map(rows.results.map((r) => [r.category_id, r.n]));
  }

  async usageOf(id: number) {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM schedule_slot_categories WHERE category_id = ?').bind(id).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async create(c: Omit<TimeCategory, 'id' | 'sort'>) {
    const max = await this.db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM time_categories').first<{ m: number }>();
    const res = await this.db
      .prepare('INSERT INTO time_categories (name_th, name_en, color, sort) VALUES (?, ?, ?, ?)')
      .bind(c.nameTh, c.nameEn, c.color, (max?.m ?? 0) + 1)
      .run();
    return Number(res.meta.last_row_id);
  }

  async update(id: number, patch: Partial<Omit<TimeCategory, 'id'>>) {
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) return true;
    const res = await this.db
      .prepare(`UPDATE time_categories SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => (patch as Record<string, unknown>)[k]), id)
      .run();
    return !!res.meta.changes;
  }

  async delete(id: number) {
    const res = await this.db.prepare('DELETE FROM time_categories WHERE id = ?').bind(id).run();
    return !!res.meta.changes;
  }
}

const COURSE_CAT_COLUMNS: Record<string, string> = { nameTh: 'name_th', nameEn: 'name_en', icon: 'icon', tint: 'tint', sort: 'sort' };

export class D1CourseCategoryRepository implements CourseCategoryRepository {
  constructor(private db: D1Database) {}

  async list(): Promise<CourseCategory[]> {
    const rows = await this.db.prepare('SELECT id, name_th, name_en, icon, tint, sort FROM course_categories ORDER BY sort, id').all<Record<string, unknown>>();
    return rows.results.map((c) => ({ id: Number(c.id), nameTh: String(c.name_th), nameEn: String(c.name_en), icon: String(c.icon), tint: String(c.tint), sort: Number(c.sort) }));
  }

  async usageOf(id: number) {
    const r = await this.db
      .prepare('SELECT (SELECT COUNT(*) FROM courses WHERE category_id = ?1) + (SELECT COUNT(*) FROM packs WHERE category_id = ?1) AS n')
      .bind(id)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async create(c: Omit<CourseCategory, 'id' | 'sort'>) {
    const max = await this.db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM course_categories').first<{ m: number }>();
    const res = await this.db
      .prepare('INSERT INTO course_categories (name_th, name_en, icon, tint, sort) VALUES (?, ?, ?, ?, ?)')
      .bind(c.nameTh, c.nameEn, c.icon, c.tint, (max?.m ?? 0) + 1)
      .run();
    return Number(res.meta.last_row_id);
  }

  async update(id: number, patch: Partial<Omit<CourseCategory, 'id'>>) {
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) return true;
    const res = await this.db
      .prepare(`UPDATE course_categories SET ${keys.map((k) => `${COURSE_CAT_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => (patch as Record<string, unknown>)[k]), id)
      .run();
    return !!res.meta.changes;
  }

  async delete(id: number) {
    const res = await this.db.prepare('DELETE FROM course_categories WHERE id = ?').bind(id).run();
    return !!res.meta.changes;
  }
}
