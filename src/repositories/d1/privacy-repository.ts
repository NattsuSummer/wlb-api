import { DEFAULT_PRIVACY, type Privacy } from '../../domain/privacy';
import type { PrivacyRepository } from '../interfaces';
import type { D1Database } from './db';

interface Row {
  private_mode: number;
  schedule: Privacy['schedule'];
  now_status: Privacy['nowStatus'];
  summary: Privacy['summary'];
  courses: Privacy['courses'];
  answers: Privacy['answers'];
}

export class D1PrivacyRepository implements PrivacyRepository {
  constructor(private db: D1Database) {}

  async load(userId: number): Promise<Privacy> {
    const r = await this.db.prepare('SELECT * FROM user_privacy WHERE user_id = ?').bind(userId).first<Row>();
    if (!r) return { ...DEFAULT_PRIVACY };
    return { privateMode: !!r.private_mode, schedule: r.schedule, nowStatus: r.now_status, summary: r.summary, courses: r.courses, answers: r.answers };
  }

  async save(userId: number, p: Privacy) {
    await this.db
      .prepare(
        `INSERT INTO user_privacy (user_id, private_mode, schedule, now_status, summary, courses, answers)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET private_mode = excluded.private_mode, schedule = excluded.schedule,
           now_status = excluded.now_status, summary = excluded.summary, courses = excluded.courses, answers = excluded.answers`,
      )
      .bind(userId, p.privateMode ? 1 : 0, p.schedule, p.nowStatus, p.summary, p.courses, p.answers)
      .run();
  }
}
