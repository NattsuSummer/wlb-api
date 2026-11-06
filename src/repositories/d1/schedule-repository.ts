import { emptyWeek, type Slot } from '../../domain/schedule';
import { slotIndex } from '../../domain/time';
import type { ScheduleRepository } from '../interfaces';
import type { D1Database, D1PreparedStatement } from './db';

export class D1ScheduleRepository implements ScheduleRepository {
  constructor(private db: D1Database) {}

  async loadWeek(userId: number) {
    const rows = (
      await this.db
        .prepare(
          `SELECT s.weekday, s.hour, s.description, GROUP_CONCAT(sc.category_id) AS cats
             FROM schedule_slots s
             JOIN schedule_slot_categories sc ON sc.slot_id = s.id
            WHERE s.user_id = ?
            GROUP BY s.id`,
        )
        .bind(userId)
        .all<{ weekday: number; hour: number; description: string; cats: string }>()
    ).results;
    const week = emptyWeek();
    for (const r of rows) {
      const categoryIds = String(r.cats).split(',').map(Number).sort((a, b) => a - b);
      week[slotIndex(r.weekday, r.hour)] = { categoryIds, description: r.description };
    }
    return week;
  }

  async saveCells(userId: number, cells: { weekday: number; hour: number; slot: Slot | null }[]) {
    if (!cells.length) return;
    const stmts: D1PreparedStatement[] = [];
    for (const c of cells) {
      stmts.push(this.db.prepare('DELETE FROM schedule_slots WHERE user_id = ? AND weekday = ? AND hour = ?').bind(userId, c.weekday, c.hour));
      if (!c.slot) continue;
      stmts.push(
        this.db.prepare('INSERT INTO schedule_slots (user_id, weekday, hour, description) VALUES (?, ?, ?, ?)').bind(userId, c.weekday, c.hour, c.slot.description),
      );
      for (const cat of c.slot.categoryIds) {
        stmts.push(
          this.db
            .prepare('INSERT INTO schedule_slot_categories (slot_id, category_id) SELECT id, ? FROM schedule_slots WHERE user_id = ? AND weekday = ? AND hour = ?')
            .bind(cat, userId, c.weekday, c.hour),
        );
      }
    }
    await this.db.batch(stmts);
  }

  async loadTargets(userId: number) {
    const rows = (
      await this.db.prepare('SELECT category_id, pct FROM user_category_targets WHERE user_id = ?').bind(userId).all<{ category_id: number; pct: number }>()
    ).results;
    const out: Record<number, number> = {};
    for (const r of rows) out[r.category_id] = r.pct;
    return out;
  }

  async saveTargets(userId: number, targets: Record<number, number>) {
    const stmts = [this.db.prepare('DELETE FROM user_category_targets WHERE user_id = ?').bind(userId)];
    for (const [cat, pct] of Object.entries(targets)) {
      stmts.push(this.db.prepare('INSERT INTO user_category_targets (user_id, category_id, pct) VALUES (?, ?, ?)').bind(userId, Number(cat), pct));
    }
    await this.db.batch(stmts);
  }
}
