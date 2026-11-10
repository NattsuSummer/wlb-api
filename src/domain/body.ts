// Body stats: weekly check-ins (weight, height, waist, body fat) and a summary for the chart page.
import { validationError } from './errors';

export interface BodyEntry {
  date: string; // YYYY-MM-DD
  weightKg: number;
  heightCm: number | null;
  waistCm: number | null;
  bodyFat: number | null;
  note: string;
}
export interface BodyGoal { targetWeightKg: number | null }

export const BODY_LIMITS = {
  weightKg: [20, 400], heightCm: [80, 250], waistCm: [30, 250], bodyFat: [2, 75], note: 300,
} as const;
/** How many days until a new check-in is due. */
export const CHECKIN_DAYS = 7;

const OFFSET_MS = 7 * 60 * 60 * 1000;
export const bangkokDate = (at: Date) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const round1 = (n: number) => Math.round(n * 10) / 10;

function num(v: unknown, field: string, [min, max]: readonly [number, number], required: boolean): number | null {
  if (v === null || v === undefined || v === '') {
    if (required) throw validationError(`${field} is required`, { field });
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw validationError(`${field} must be a number`, { field });
  if (n < min || n > max) throw validationError(`${field} must be between ${min} and ${max}`, { field });
  return round1(n);
}

export function parseDate(v: unknown, today: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
    throw validationError('date must be YYYY-MM-DD', { field: 'date' });
  }
  if (v > today) throw validationError('date cannot be in the future', { field: 'date' });
  if (v < '2000-01-01') throw validationError('date is too old', { field: 'date' });
  return v;
}

export function parseEntry(date: string, b: Record<string, unknown>): BodyEntry {
  const note = b.note === undefined || b.note === null ? '' : String(b.note).trim();
  if (note.length > BODY_LIMITS.note) throw validationError(`note must be at most ${BODY_LIMITS.note} characters`, { field: 'note' });
  return {
    date,
    weightKg: num(b.weightKg, 'weightKg', BODY_LIMITS.weightKg, true)!,
    heightCm: num(b.heightCm, 'heightCm', BODY_LIMITS.heightCm, false),
    waistCm: num(b.waistCm, 'waistCm', BODY_LIMITS.waistCm, false),
    bodyFat: num(b.bodyFat, 'bodyFat', BODY_LIMITS.bodyFat, false),
    note,
  };
}

export function parseGoal(b: Record<string, unknown>): BodyGoal {
  return { targetWeightKg: num(b.targetWeightKg, 'targetWeightKg', BODY_LIMITS.weightKg, false) };
}

export const bmi = (weightKg: number, heightCm: number | null) => (heightCm ? round1(weightKg / (heightCm / 100) ** 2) : null);

/** Entries must be sorted by date ascending. */
export function bodySummary(entries: BodyEntry[], goal: BodyGoal, today: string) {
  const first = entries[0] ?? null;
  const last = entries[entries.length - 1] ?? null;
  // Height rarely changes: use the latest one given.
  const height = [...entries].reverse().find((e) => e.heightCm !== null)?.heightCm ?? null;
  const daysSinceLast = last ? daysBetween(last.date, today) : null;
  // Change over roughly the last week: compare with the newest entry at least 5 days older.
  const weekAgo = last ? [...entries].reverse().find((e) => daysBetween(e.date, last.date) >= 5) : undefined;
  const spanWeeks = first && last ? daysBetween(first.date, last.date) / 7 : 0;
  return {
    latest: last,
    heightCm: height,
    bmi: last ? bmi(last.weightKg, height) : null,
    startWeightKg: first?.weightKg ?? null,
    changeKg: first && last ? round1(last.weightKg - first.weightKg) : null,
    lastWeekChangeKg: last && weekAgo ? round1(last.weightKg - weekAgo.weightKg) : null,
    avgPerWeekKg: first && last && spanWeeks >= 1 ? round1((last.weightKg - first.weightKg) / spanWeeks) : null,
    toGoalKg: last && goal.targetWeightKg !== null ? round1(last.weightKg - goal.targetWeightKg) : null,
    daysSinceLast,
    due: daysSinceLast === null || daysSinceLast >= CHECKIN_DAYS,
    nextDue: last ? new Date(Date.parse(`${last.date}T00:00:00Z`) + CHECKIN_DAYS * 86_400_000).toISOString().slice(0, 10) : today,
  };
}
