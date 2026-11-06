// Pure schedule logic (no DB) so it can be unit-tested directly.
import { slotIndex, type WeekTime } from './time';

export interface Slot {
  categoryIds: number[]; // sorted, unique, ≥ 1
  description: string;
}
/** 168 entries (7 days × 24 hours); null = nothing planned. */
export type Week = (Slot | null)[];

export interface RangeInput {
  days: number[];   // weekdays 0…6
  from: number;     // hour 0…23 (inclusive)
  to: number;       // hour 1…24 (exclusive)
}

export const emptyWeek = (): Week => Array.from({ length: 168 }, () => null);

export function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (!a || !b) return a === b;
  return a.description === b.description && a.categoryIds.length === b.categoryIds.length && a.categoryIds.every((c, i) => c === b.categoryIds[i]);
}

export function normalizeSlot(categoryIds: number[], description: string): Slot {
  return { categoryIds: [...new Set(categoryIds)].sort((a, b) => a - b), description: description.trim() };
}

function* cells(r: RangeInput): Generator<[number, number]> {
  for (const d of r.days) for (let h = r.from; h < r.to; h++) yield [d, h];
}

export interface Overwrite {
  weekday: number;
  from: number;
  to: number;
  before: Slot;
}

export interface RangePlan {
  after: Week;
  /** Planned cells that will be replaced by something different, grouped into runs. */
  overwrites: Overwrite[];
  overwriteCount: number;
  /** Empty cells that will be filled. */
  fillCount: number;
  /** Cells that already hold exactly this value. */
  unchangedCount: number;
}

/** What happens if `value` (or null = clear) is written to every cell of the range. */
export function planRange(week: Week, range: RangeInput, value: Slot | null): RangePlan {
  const after = week.slice();
  const overwrites: Overwrite[] = [];
  let overwriteCount = 0, fillCount = 0, unchangedCount = 0;
  for (const [d, h] of cells(range)) {
    const i = slotIndex(d, h);
    const before = week[i] ?? null;
    after[i] = value;
    if (sameSlot(before, value)) { unchangedCount++; continue; }
    if (!before) { fillCount++; continue; }
    if (value === null) continue; // clearing is not an "overwrite"
    overwriteCount++;
    const last = overwrites[overwrites.length - 1];
    if (last && last.weekday === d && last.to === h && sameSlot(last.before, before)) last.to = h + 1;
    else overwrites.push({ weekday: d, from: h, to: h + 1, before });
  }
  return { after, overwrites, overwriteCount, fillCount, unchangedCount };
}

/** The block of identical consecutive cells around (weekday, hour) on that day. */
export function blockAt(week: Week, weekday: number, hour: number): { from: number; to: number; slot: Slot } | null {
  const slot = week[slotIndex(weekday, hour)] ?? null;
  if (!slot) return null;
  let from = hour, to = hour + 1;
  while (from > 0 && sameSlot(week[slotIndex(weekday, from - 1)] ?? null, slot)) from--;
  while (to < 24 && sameSlot(week[slotIndex(weekday, to)] ?? null, slot)) to++;
  return { from, to, slot };
}

export interface CategoryShare {
  categoryId: number;
  hours: number;   // may be fractional (multi-category slots split equally)
  pct: number;     // of 168 hours
  target: number;  // expected %, 0 = not set
  diff: number;    // pct − target
}

export interface Summary {
  plannedHours: number;
  unplannedHours: number;
  targetsSet: boolean;
  categories: CategoryShare[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function summarize(week: Week, categoryIds: number[], targets: Record<number, number>): Summary {
  const hours = new Map<number, number>(categoryIds.map((id) => [id, 0]));
  let planned = 0;
  for (const s of week) {
    if (!s || s.categoryIds.length === 0) continue;
    planned++;
    const share = 1 / s.categoryIds.length;
    for (const c of s.categoryIds) hours.set(c, (hours.get(c) ?? 0) + share);
  }
  const targetsSet = Object.values(targets).some((v) => v > 0);
  return {
    plannedHours: planned,
    unplannedHours: 168 - planned,
    targetsSet,
    categories: [...hours.entries()].map(([categoryId, h]) => {
      const pct = (h / 168) * 100;
      const target = targets[categoryId] ?? 0;
      return { categoryId, hours: round(h, 3), pct: round(pct), target, diff: round(pct - target) };
    }),
  };
}

/** Targets must be all zero ("not set") or add up to exactly 100. */
export function targetsProblem(targets: Record<number, number>): string | null {
  const values = Object.values(targets);
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 100)) return 'Each target must be an integer 0–100';
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum !== 0 && sum !== 100) return `Targets must add up to 100 (now ${sum})`;
  return null;
}

export interface NowInfo {
  weekday: number;
  hour: number;
  minute: number;
  current: { from: number; to: number; slot: Slot; minutesLeft: number } | null;
  next: { weekday: number; hour: number; slot: Slot | null } | null;
}

/** What is planned right now, how long it lasts, and what comes next (looking up to 24h ahead). */
export function nowInfo(week: Week, t: WeekTime): NowInfo {
  const block = blockAt(week, t.weekday, t.hour);
  const current = block ? { ...block, minutesLeft: (block.to - t.hour) * 60 - t.minute } : null;
  // next = first cell after the current block (or after now) that differs
  let idx = slotIndex(t.weekday, block ? block.to - 1 : t.hour);
  const here = week[idx] ?? null;
  let next: NowInfo['next'] = null;
  for (let step = 1; step <= 24; step++) {
    const j = (idx + step) % 168;
    const s = week[j] ?? null;
    if (!sameSlot(s, here)) { next = { weekday: Math.floor(j / 24), hour: j % 24, slot: s }; break; }
  }
  return { weekday: t.weekday, hour: t.hour, minute: t.minute, current, next };
}
