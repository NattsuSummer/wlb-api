// Database access for users, categories, schedules and privacy.
import type { D1Database, D1PreparedStatement } from './db';
import { DEFAULT_PRIVACY, type Privacy } from './lib/privacy';
import { emptyWeek, type Week } from './lib/schedule';
import { slotIndex } from './lib/time';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  locale: 'th' | 'en';
  theme: 'dark' | 'light' | 'system';
  avatar_color: string | null;
  must_change_password: number;
  disabled: number;
  last_login_at: string | null;
  created_at: string;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    avatarColor: u.avatar_color,
  };
}

export function selfUser(u: UserRow) {
  return {
    ...publicUser(u),
    locale: u.locale,
    theme: u.theme,
    mustChangePassword: !!u.must_change_password,
  };
}

const USER_COLS = 'id, username, display_name, role, locale, theme, avatar_color, must_change_password, disabled, last_login_at, created_at';

export const getUser = (db: D1Database, id: number) =>
  db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>();

export const getUserByName = (db: D1Database, username: string) =>
  db.prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`).bind(username).first<UserRow>();

export async function listUsers(db: D1Database, includeDisabled = false): Promise<UserRow[]> {
  const sql = `SELECT ${USER_COLS} FROM users ${includeDisabled ? '' : 'WHERE disabled = 0'} ORDER BY id`;
  return (await db.prepare(sql).all<UserRow>()).results;
}

// ---------- categories ----------
export interface TimeCategoryRow {
  id: number;
  name_th: string;
  name_en: string;
  color: string;
  sort: number;
}

export async function listTimeCategories(db: D1Database): Promise<TimeCategoryRow[]> {
  return (await db.prepare('SELECT id, name_th, name_en, color, sort FROM time_categories ORDER BY sort, id').all<TimeCategoryRow>()).results;
}

export const categoryOut = (c: TimeCategoryRow) => ({ id: c.id, nameTh: c.name_th, nameEn: c.name_en, color: c.color, sort: c.sort });

// ---------- schedule ----------
export async function loadWeek(db: D1Database, userId: number): Promise<Week> {
  const rows = (
    await db
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

/** Write the given cells (null = clear). Runs as one atomic batch. */
export async function saveCells(db: D1Database, userId: number, cells: { weekday: number; hour: number; slot: Week[number] }[]): Promise<void> {
  if (!cells.length) return;
  const stmts: D1PreparedStatement[] = [];
  for (const c of cells) {
    stmts.push(db.prepare('DELETE FROM schedule_slots WHERE user_id = ? AND weekday = ? AND hour = ?').bind(userId, c.weekday, c.hour));
    if (!c.slot) continue;
    stmts.push(
      db.prepare('INSERT INTO schedule_slots (user_id, weekday, hour, description) VALUES (?, ?, ?, ?)').bind(userId, c.weekday, c.hour, c.slot.description),
    );
    for (const cat of c.slot.categoryIds) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO schedule_slot_categories (slot_id, category_id) SELECT id, ? FROM schedule_slots WHERE user_id = ? AND weekday = ? AND hour = ?',
          )
          .bind(cat, userId, c.weekday, c.hour),
      );
    }
  }
  await db.batch(stmts);
}

export async function loadTargets(db: D1Database, userId: number): Promise<Record<number, number>> {
  const rows = (await db.prepare('SELECT category_id, pct FROM user_category_targets WHERE user_id = ?').bind(userId).all<{ category_id: number; pct: number }>()).results;
  const out: Record<number, number> = {};
  for (const r of rows) out[r.category_id] = r.pct;
  return out;
}

export async function saveTargets(db: D1Database, userId: number, targets: Record<number, number>): Promise<void> {
  const stmts = [db.prepare('DELETE FROM user_category_targets WHERE user_id = ?').bind(userId)];
  for (const [cat, pct] of Object.entries(targets)) {
    stmts.push(db.prepare('INSERT INTO user_category_targets (user_id, category_id, pct) VALUES (?, ?, ?)').bind(userId, Number(cat), pct));
  }
  await db.batch(stmts);
}

// ---------- privacy ----------
interface PrivacyRow {
  private_mode: number;
  schedule: Privacy['schedule'];
  now_status: Privacy['nowStatus'];
  summary: Privacy['summary'];
  courses: Privacy['courses'];
  answers: Privacy['answers'];
}

export async function loadPrivacy(db: D1Database, userId: number): Promise<Privacy> {
  const r = await db.prepare('SELECT * FROM user_privacy WHERE user_id = ?').bind(userId).first<PrivacyRow>();
  if (!r) return { ...DEFAULT_PRIVACY };
  return { privateMode: !!r.private_mode, schedule: r.schedule, nowStatus: r.now_status, summary: r.summary, courses: r.courses, answers: r.answers };
}

export async function savePrivacy(db: D1Database, userId: number, p: Privacy): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_privacy (user_id, private_mode, schedule, now_status, summary, courses, answers)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET private_mode = excluded.private_mode, schedule = excluded.schedule,
         now_status = excluded.now_status, summary = excluded.summary, courses = excluded.courses, answers = excluded.answers`,
    )
    .bind(userId, p.privateMode ? 1 : 0, p.schedule, p.nowStatus, p.summary, p.courses, p.answers)
    .run();
}
