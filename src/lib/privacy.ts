import type { Slot, Week } from './schedule';

export interface Privacy {
  privateMode: boolean;
  schedule: 'full' | 'cat' | 'hide';
  nowStatus: 'full' | 'cat' | 'hide';
  summary: 'show' | 'hide';
  courses: 'show' | 'hide';
  answers: 'show' | 'hide';
}

export const DEFAULT_PRIVACY: Privacy = {
  privateMode: false,
  schedule: 'full',
  nowStatus: 'full',
  summary: 'show',
  courses: 'show',
  answers: 'hide',
};

export type Area = 'schedule' | 'nowStatus' | 'summary' | 'courses' | 'answers';

/**
 * What another member may see of `area`. The owner always sees everything.
 * Admins follow the same rules as everyone else (decided 2026-11-03).
 */
export function visibility(p: Privacy, area: Area, isOwner: boolean): 'full' | 'cat' | 'hide' {
  if (isOwner) return 'full';
  if (p.privateMode) return 'hide';
  const v = p[area];
  if (v === 'show') return 'full';
  return v;
}

/** Strip descriptions when only categories may be shown. */
export function maskSlot(s: Slot | null, level: 'full' | 'cat' | 'hide'): Slot | null {
  if (!s || level === 'hide') return null;
  return level === 'cat' ? { categoryIds: s.categoryIds, description: '' } : s;
}

export const maskWeek = (w: Week, level: 'full' | 'cat' | 'hide'): Week => w.map((s) => maskSlot(s, level));
