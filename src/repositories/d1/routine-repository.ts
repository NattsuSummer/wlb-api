import type { Assignment, PlanEntry, RoutineItem, RoutinePlan } from '../../domain/routine';
import type { ItemWrite, PlanWrite, RoutineRepository } from '../interfaces';
import type { D1Database, D1PreparedStatement } from './db';

type Row = Record<string, unknown>;
const parse = <T>(s: unknown, fallback: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return fallback; }
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const toItem = (r: Row): RoutineItem => ({
  id: Number(r.id), kind: r.kind as 'exercise', title: String(r.title), description: String(r.description), bodyMd: String(r.body_md),
  data: parse(r.data_json, {}) as never, images: parse(r.images_json, []), links: parse(r.links_json, []),
  visibility: r.visibility as 'group', status: r.status as 'published', createdBy: num(r.created_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

const toPlan = (r: Row): RoutinePlan => ({
  id: Number(r.id), kind: r.kind as 'workout', title: String(r.title), description: String(r.description), visibility: r.visibility as 'group',
  status: r.status as 'published', createdBy: num(r.created_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

const toEntry = (r: Row): PlanEntry => ({
  id: Number(r.id), planId: Number(r.plan_id), sort: Number(r.sort), section: String(r.section), itemId: Number(r.item_id),
  sets: num(r.sets), reps: (r.reps as string) ?? null, seconds: num(r.seconds), restSeconds: num(r.rest_seconds), servings: num(r.servings), note: String(r.note),
});

export class D1RoutineRepository implements RoutineRepository {
  constructor(private db: D1Database) {}

  async listItems() {
    return (await this.db.prepare('SELECT * FROM routine_items ORDER BY title COLLATE NOCASE, id').all<Row>()).results.map(toItem);
  }

  async findItem(id: number) {
    const r = await this.db.prepare('SELECT * FROM routine_items WHERE id = ?').bind(id).first<Row>();
    return r ? toItem(r) : null;
  }

  async createItem(w: ItemWrite, createdBy: number) {
    const res = await this.db
      .prepare('INSERT INTO routine_items (kind, title, description, body_md, data_json, images_json, links_json, visibility, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(w.kind, w.title, w.description, w.bodyMd, JSON.stringify(w.data), JSON.stringify(w.images), JSON.stringify(w.links), w.visibility, w.status, createdBy)
      .run();
    return Number(res.meta.last_row_id);
  }

  async updateItem(id: number, w: ItemWrite) {
    await this.db
      .prepare(`UPDATE routine_items SET title = ?, description = ?, body_md = ?, data_json = ?, images_json = ?, links_json = ?, visibility = ?, status = ?, updated_at = ${NOW} WHERE id = ?`)
      .bind(w.title, w.description, w.bodyMd, JSON.stringify(w.data), JSON.stringify(w.images), JSON.stringify(w.links), w.visibility, w.status, id)
      .run();
  }

  async patchItem(id: number, p: { visibility?: string; status?: string }) {
    await this.patch('routine_items', id, p);
  }

  async deleteItem(id: number) {
    return !!(await this.db.prepare('DELETE FROM routine_items WHERE id = ?').bind(id).run()).meta.changes;
  }

  async itemUsage(id: number) {
    return (await this.db.prepare('SELECT COUNT(*) AS n FROM routine_plan_entries WHERE item_id = ?').bind(id).first<{ n: number }>())?.n ?? 0;
  }

  async listPlans() {
    return (await this.db.prepare('SELECT * FROM routine_plans ORDER BY title COLLATE NOCASE, id').all<Row>()).results.map(toPlan);
  }

  async findPlan(id: number) {
    const r = await this.db.prepare('SELECT * FROM routine_plans WHERE id = ?').bind(id).first<Row>();
    return r ? toPlan(r) : null;
  }

  async entries(planId: number) {
    return (await this.db.prepare('SELECT * FROM routine_plan_entries WHERE plan_id = ? ORDER BY sort, id').bind(planId).all<Row>()).results.map(toEntry);
  }

  async allEntries() {
    return (await this.db.prepare('SELECT * FROM routine_plan_entries ORDER BY plan_id, sort, id').all<Row>()).results.map(toEntry);
  }

  async createPlan(w: PlanWrite, createdBy: number) {
    const PID = '(SELECT MAX(id) FROM routine_plans)'; // inside one batch (= one transaction) this is the new plan
    const res = await this.db.batch([
      this.db
        .prepare('INSERT INTO routine_plans (kind, title, description, visibility, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(w.kind, w.title, w.description, w.visibility, w.status, createdBy),
      ...this.entryInserts(PID, w),
    ]);
    return Number(res[0]!.meta.last_row_id);
  }

  async replacePlan(id: number, w: PlanWrite) {
    await this.db.batch([
      this.db.prepare(`UPDATE routine_plans SET title = ?, description = ?, visibility = ?, status = ?, updated_at = ${NOW} WHERE id = ?`)
        .bind(w.title, w.description, w.visibility, w.status, id),
      this.db.prepare('DELETE FROM routine_plan_entries WHERE plan_id = ?').bind(id),
      ...this.entryInserts(String(id), w),
    ]);
  }

  async patchPlan(id: number, p: { visibility?: string; status?: string }) {
    await this.patch('routine_plans', id, p);
  }

  async deletePlan(id: number) {
    return !!(await this.db.prepare('DELETE FROM routine_plans WHERE id = ?').bind(id).run()).meta.changes;
  }

  async assignments(userId: number): Promise<Assignment[]> {
    const rows = await this.db.prepare('SELECT * FROM routine_assignments WHERE user_id = ? ORDER BY weekday, hour IS NULL DESC, hour').bind(userId).all<Row>();
    return rows.results.map((r) => ({ id: Number(r.id), userId: Number(r.user_id), planId: Number(r.plan_id), weekday: Number(r.weekday), hour: num(r.hour) }));
  }

  async setAssignments(userId: number, planId: number, slots: { weekday: number; hour: number | null }[]) {
    await this.db.batch([
      this.db.prepare('DELETE FROM routine_assignments WHERE user_id = ? AND plan_id = ?').bind(userId, planId),
      ...slots.map((s) => this.db.prepare('INSERT INTO routine_assignments (user_id, plan_id, weekday, hour) VALUES (?, ?, ?, ?)').bind(userId, planId, s.weekday, s.hour)),
    ]);
  }

  private entryInserts(planRef: string, w: PlanWrite): D1PreparedStatement[] {
    return w.entries.map((e, i) =>
      this.db
        .prepare(`INSERT INTO routine_plan_entries (plan_id, sort, section, item_id, sets, reps, seconds, rest_seconds, servings, note) VALUES (${planRef}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(i, e.section, e.itemId, e.sets, e.reps, e.seconds, e.restSeconds, e.servings, e.note));
  }

  private async patch(table: string, id: number, p: { visibility?: string; status?: string }) {
    const keys = (['visibility', 'status'] as const).filter((k) => p[k] !== undefined);
    if (!keys.length) return;
    await this.db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ${NOW} WHERE id = ?`).bind(...keys.map((k) => p[k]), id).run();
  }
}
