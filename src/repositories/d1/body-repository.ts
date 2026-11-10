import type { BodyEntry, BodyGoal } from '../../domain/body';
import type { BodyRepository } from '../interfaces';
import type { D1Database } from './db';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toEntry = (r: Row): BodyEntry => ({
  date: String(r.date), weightKg: Number(r.weight_kg), heightCm: num(r.height_cm), waistCm: num(r.waist_cm), bodyFat: num(r.body_fat), note: String(r.note ?? ''),
});
const COLS = 'date, weight_kg, height_cm, waist_cm, body_fat, note';

export class D1BodyRepository implements BodyRepository {
  constructor(private db: D1Database) {}

  async entries(userId: number) {
    const r = await this.db.prepare(`SELECT ${COLS} FROM body_entries WHERE user_id = ? ORDER BY date`).bind(userId).all<Row>();
    return r.results.map(toEntry);
  }

  async lastEntry(userId: number) {
    const r = await this.db.prepare(`SELECT ${COLS} FROM body_entries WHERE user_id = ? ORDER BY date DESC LIMIT 1`).bind(userId).first<Row>();
    return r ? toEntry(r) : null;
  }

  async upsertEntry(userId: number, e: BodyEntry) {
    await this.db.prepare(
      `INSERT INTO body_entries (user_id, date, weight_kg, height_cm, waist_cm, body_fat, note) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, height_cm = excluded.height_cm, waist_cm = excluded.waist_cm,
         body_fat = excluded.body_fat, note = excluded.note, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(userId, e.date, e.weightKg, e.heightCm, e.waistCm, e.bodyFat, e.note).run();
  }

  async deleteEntry(userId: number, date: string) {
    const r = await this.db.prepare('DELETE FROM body_entries WHERE user_id = ? AND date = ?').bind(userId, date).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async goal(userId: number): Promise<BodyGoal> {
    const r = await this.db.prepare('SELECT target_weight_kg FROM body_goals WHERE user_id = ?').bind(userId).first<Row>();
    return { targetWeightKg: num(r?.target_weight_kg) };
  }

  async setGoal(userId: number, g: BodyGoal) {
    await this.db.prepare(
      `INSERT INTO body_goals (user_id, target_weight_kg) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET target_weight_kg = excluded.target_weight_kg, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(userId, g.targetWeightKg).run();
  }
}
