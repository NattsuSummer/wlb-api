// Routines: exercises and meals (the library), plans built from them, and links to the week. Pure rules, no I/O.
import type { CourseStatus, Image, Issue, Link, Visibility } from './course';
import { VISIBILITIES } from './course';

export const ITEM_KINDS = ['exercise', 'meal'] as const;
export const PLAN_KINDS = ['workout', 'meal'] as const;
export const MUSCLES = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core', 'full_body', 'cardio', 'mobility'] as const;
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const WORKOUT_SECTIONS = ['warmup', 'main', 'cooldown'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type PlanKind = (typeof PLAN_KINDS)[number];
export type Muscle = (typeof MUSCLES)[number];
export type MealType = (typeof MEAL_TYPES)[number];

export const itemKindFor = (k: PlanKind): ItemKind => (k === 'workout' ? 'exercise' : 'meal');
export const sectionsFor = (k: PlanKind): readonly string[] => (k === 'workout' ? WORKOUT_SECTIONS : MEAL_TYPES);

export interface ExerciseData { muscles: Muscle[]; equipment: string; sets: number | null; reps: string | null; seconds: number | null }
export interface Nutrition { calories: number | null; protein: number | null; carbs: number | null; fat: number | null }
export interface MealData extends Nutrition { mealTypes: MealType[]; ingredients: string[]; servingNote: string }

interface ItemBase {
  id: number; title: string; description: string; bodyMd: string; images: Image[]; links: Link[];
  visibility: Visibility; status: CourseStatus; createdBy: number | null; createdAt: string; updatedAt: string;
}
export type RoutineItem = ItemBase & ({ kind: 'exercise'; data: ExerciseData } | { kind: 'meal'; data: MealData });

export interface RoutinePlan {
  id: number; kind: PlanKind; title: string; description: string; visibility: Visibility; status: CourseStatus;
  createdBy: number | null; createdAt: string; updatedAt: string;
}
export interface PlanEntry {
  id: number; planId: number; sort: number; section: string; itemId: number;
  sets: number | null; reps: string | null; seconds: number | null; restSeconds: number | null; servings: number | null; note: string;
}
export interface Assignment { id: number; userId: number; planId: number; weekday: number; hour: number | null }

// ---------- totals ----------
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Meal plan totals: each entry counts item nutrition × servings (default 1). Missing numbers are reported, not guessed. */
export function mealTotals(entries: Pick<PlanEntry, 'itemId' | 'servings' | 'section'>[], items: Map<number, RoutineItem>) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const bySection: Record<string, number> = {};
  let missing = 0;
  for (const e of entries) {
    const it = items.get(e.itemId);
    if (!it || it.kind !== 'meal') continue;
    const k = e.servings ?? 1;
    if (it.data.calories === null) missing++;
    t.calories += (it.data.calories ?? 0) * k;
    t.protein += (it.data.protein ?? 0) * k;
    t.carbs += (it.data.carbs ?? 0) * k;
    t.fat += (it.data.fat ?? 0) * k;
    bySection[e.section] = round1((bySection[e.section] ?? 0) + (it.data.calories ?? 0) * k);
  }
  const macroKcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  const pct = (g: number, perG: number) => (macroKcal > 0 ? Math.round(((g * perG) / macroKcal) * 100) : 0);
  return {
    calories: Math.round(t.calories), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat),
    split: { protein: pct(t.protein, 4), carbs: pct(t.carbs, 4), fat: pct(t.fat, 9) },
    bySection, itemsWithoutCalories: missing,
  };
}

/** Rough workout length: (sets × (seconds or ~40 s per set) + rest between sets). */
export function workoutMinutes(entries: Pick<PlanEntry, 'sets' | 'seconds' | 'restSeconds'>[]) {
  let s = 0;
  for (const e of entries) {
    const sets = e.sets ?? 1;
    s += sets * (e.seconds ?? 40) + Math.max(0, sets - 1) * (e.restSeconds ?? 60);
  }
  return Math.max(1, Math.round(s / 60));
}

// ---------- import format ----------
export const RLIMITS = { title: 120, description: 2000, body: 20000, items: 100, plans: 30, entries: 60, list: 40 };

export interface ItemDraft {
  id?: number; key: string; kind: ItemKind; title: string; description: string; bodyMd: string; images: Image[]; links: Link[];
  visibility: Visibility; data: ExerciseData | MealData;
}
export interface EntryDraft {
  section: string; itemRef: { id: number } | { key: string }; sets: number | null; reps: string | null; seconds: number | null;
  restSeconds: number | null; servings: number | null; note: string;
}
export interface PlanDraft { id?: number; kind: PlanKind; title: string; description: string; visibility: Visibility; entries: EntryDraft[] }
export interface RoutineDraft { items: ItemDraft[]; plans: PlanDraft[] }
export interface RoutineValidation { errors: Issue[]; warnings: Issue[]; draft: RoutineDraft | null }

type Known = Pick<RoutineItem, 'id' | 'title' | 'kind'>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Check `{ items: [...], plans: [...] }` (either may be omitted, or pass a single item / plan object).
 * Plan entries refer to items by `item` = title (from this import or the existing library) or `itemId`.
 */
export function validateRoutines(input: unknown, library: Known[]): RoutineValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (p: string, m: string) => errors.push({ path: p, message: m });
  const warn = (p: string, m: string) => warnings.push({ path: p, message: m });
  if (!isObj(input)) return { errors: [{ path: '', message: 'Top level must be a JSON object' }], warnings, draft: null };

  let rawItems: unknown[] = [];
  let rawPlans: unknown[] = [];
  let itemsBase = 'items', plansBase = 'plans';
  if ('items' in input || 'plans' in input) {
    if (input.items !== undefined && !Array.isArray(input.items)) err('items', 'must be a list');
    if (input.plans !== undefined && !Array.isArray(input.plans)) err('plans', 'must be a list');
    rawItems = Array.isArray(input.items) ? input.items : [];
    rawPlans = Array.isArray(input.plans) ? input.plans : [];
  } else if (input.kind === 'workout' || ('entries' in input)) { rawPlans = [input]; plansBase = 'plan'; }
  else { rawItems = [input]; itemsBase = 'item'; }
  const ip = (i: number) => (itemsBase === 'item' ? '' : `items[${i}]`);
  const pp = (i: number) => (plansBase === 'plan' ? '' : `plans[${i}]`);
  const at = (base: string, f: string) => (base ? `${base}.${f}` : f);

  if (!rawItems.length && !rawPlans.length) err('', 'Add at least one item (exercise / meal) or plan');
  if (rawItems.length > RLIMITS.items) err('items', `At most ${RLIMITS.items} items`);
  if (rawPlans.length > RLIMITS.plans) err('plans', `At most ${RLIMITS.plans} plans`);

  const text = (v: unknown, p: string, max: number, required = false) => {
    if (v === undefined || v === null || v === '') { if (required) err(p, 'is required'); return ''; }
    if (typeof v !== 'string') { err(p, 'must be text'); return ''; }
    const s = v.trim();
    if (required && !s) err(p, 'is required');
    if (s.length > max) err(p, `is too long (max ${max} characters)`);
    return s;
  };
  const num = (v: unknown, p: string, min: number, max: number, int = false): number | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
      err(p, `must be ${int ? 'a whole number' : 'a number'} from ${min} to ${max}`);
      return null;
    }
    return v;
  };
  const enumList = <T extends string>(v: unknown, p: string, values: readonly T[]): T[] => {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : [v];
    const out: T[] = [];
    arr.forEach((x, i) => {
      const s = typeof x === 'string' ? (x.trim().toLowerCase().replace(/[\s-]+/g, '_') as T) : null;
      if (s && values.includes(s)) out.push(s);
      else err(`${p}[${i}]`, `must be one of: ${values.join(', ')}`);
    });
    return [...new Set(out)];
  };
  const strList = (v: unknown, p: string) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { err(p, 'must be a list'); return []; }
    if (v.length > RLIMITS.list) err(p, `At most ${RLIMITS.list} entries`);
    return v.map((x, i) => text(x, `${p}[${i}]`, 300, true)).filter(Boolean);
  };
  const visibility = (v: unknown, p: string): Visibility => {
    if (v === undefined || v === null || v === '') return 'group';
    if (typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v)) return v as Visibility;
    err(p, 'must be one of: group, private');
    return 'group';
  };
  const urlList = <T>(v: unknown, p: string, build: (url: string, o: Record<string, unknown>, ep: string) => T): T[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { err(p, 'must be a list'); return []; }
    const out: T[] = [];
    v.forEach((x, i) => {
      const o = typeof x === 'string' ? { url: x } : x;
      if (!isObj(o) || typeof o.url !== 'string' || !/^https?:\/\/\S+$/i.test(o.url.trim())) { err(`${p}[${i}].url`, 'must be an http(s) URL'); return; }
      out.push(build(o.url.trim(), o, `${p}[${i}]`));
    });
    return out;
  };

  // ---- items ----
  const items: ItemDraft[] = [];
  const keys = new Map<string, ItemDraft>();
  rawItems.forEach((raw, i) => {
    const p = ip(i);
    if (!isObj(raw)) { err(p || 'item', 'must be an object'); return; }
    const kindRaw = typeof raw.kind === 'string' ? raw.kind.toLowerCase() : raw.calories !== undefined || raw.ingredients !== undefined ? 'meal' : 'exercise';
    const kind = kindRaw === 'food' || kindRaw === 'menu' ? 'meal' : kindRaw;
    if (!(ITEM_KINDS as readonly string[]).includes(kind)) { err(at(p, 'kind'), 'must be "exercise" or "meal"'); return; }
    const title = text(raw.title, at(p, 'title'), RLIMITS.title, true);
    const base = {
      id: typeof raw.id === 'number' ? raw.id : undefined,
      key: norm(title), title,
      description: text(raw.description, at(p, 'description'), RLIMITS.description),
      bodyMd: text(raw.instructions ?? raw.steps ?? raw.body ?? raw.content, at(p, kind === 'meal' ? 'steps' : 'instructions'), RLIMITS.body),
      images: urlList(raw.images, at(p, 'images'), (url, o, ep) => ({ url, alt: text(o.alt, `${ep}.alt`, 200) })),
      links: urlList(raw.links, at(p, 'links'), (url, o, ep) => ({ url, title: text(o.title, `${ep}.title`, RLIMITS.title) || url })),
      visibility: visibility(raw.visibility, at(p, 'visibility')),
    };
    let data: ExerciseData | MealData;
    if (kind === 'exercise') {
      data = {
        muscles: enumList(raw.muscles ?? raw.muscle, at(p, 'muscles'), MUSCLES),
        equipment: text(raw.equipment, at(p, 'equipment'), 100),
        sets: num(raw.sets, at(p, 'sets'), 1, 20, true),
        reps: raw.reps === undefined || raw.reps === null ? null : text(String(raw.reps), at(p, 'reps'), 20),
        seconds: num(raw.seconds, at(p, 'seconds'), 1, 7200, true),
      };
      if (!(data as ExerciseData).muscles.length) warn(at(p, 'muscles'), 'No muscle group: it will be harder to find');
      if (!base.bodyMd && !base.links.length) warn(p || 'item', 'No instructions or video link');
    } else {
      const n = (f: string) => num(raw[f], at(p, f), 0, f === 'calories' ? 5000 : 500);
      data = {
        mealTypes: enumList(raw.mealTypes ?? raw.mealType, at(p, 'mealTypes'), MEAL_TYPES),
        ingredients: strList(raw.ingredients, at(p, 'ingredients')),
        servingNote: text(raw.serving ?? raw.servingNote, at(p, 'serving'), 100),
        calories: n('calories'), protein: n('protein'), carbs: n('carbs'), fat: n('fat'),
      };
      const m = data as MealData;
      if (m.calories === null) warn(at(p, 'calories'), 'No calories: daily totals will be incomplete');
      if (m.calories !== null && m.protein !== null && m.carbs !== null && m.fat !== null) {
        const est = m.protein * 4 + m.carbs * 4 + m.fat * 9;
        if (est > 0 && Math.abs(est - m.calories) / m.calories > 0.25) warn(at(p, 'calories'), `Calories (${m.calories}) and P/C/F (≈${Math.round(est)} kcal) do not match well`);
      }
    }
    if (title && keys.has(base.key)) err(at(p, 'title'), 'Two items in this import have the same title');
    const it = { ...base, kind, data } as ItemDraft;
    if (title) keys.set(base.key, it);
    items.push(it);
  });

  // ---- plans ----
  const plans: PlanDraft[] = [];
  rawPlans.forEach((raw, i) => {
    const p = pp(i);
    if (!isObj(raw)) { err(p || 'plan', 'must be an object'); return; }
    const kindRaw = typeof raw.kind === 'string' ? raw.kind.toLowerCase() : '';
    const kind = (kindRaw === 'exercise' ? 'workout' : kindRaw === 'food' || kindRaw === 'diet' ? 'meal' : kindRaw) as PlanKind;
    if (!(PLAN_KINDS as readonly string[]).includes(kind)) { err(at(p, 'kind'), 'must be "workout" or "meal"'); return; }
    const title = text(raw.title, at(p, 'title'), RLIMITS.title, true);
    const entries: EntryDraft[] = [];
    if (!Array.isArray(raw.entries) || !raw.entries.length) err(at(p, 'entries'), 'A plan needs at least one entry');
    else {
      if (raw.entries.length > RLIMITS.entries) err(at(p, 'entries'), `At most ${RLIMITS.entries} entries`);
      const sections = sectionsFor(kind);
      const want = itemKindFor(kind);
      raw.entries.forEach((e: unknown, j: number) => {
        const ep = at(p, `entries[${j}]`);
        if (!isObj(e)) { err(ep, 'must be an object'); return; }
        const secRaw = typeof e.section === 'string' ? e.section.trim().toLowerCase().replace(/[\s-]+/g, '') : '';
        const section = secRaw === 'warmup' || secRaw === 'cooldown' ? secRaw : secRaw || (kind === 'workout' ? 'main' : '');
        if (!sections.includes(section)) err(`${ep}.section`, `must be one of: ${sections.join(', ')}`);
        let itemRef: EntryDraft['itemRef'] | null = null;
        if (typeof e.itemId === 'number') {
          const k = library.find((x) => x.id === e.itemId);
          if (!k) err(`${ep}.itemId`, 'Unknown item');
          else if (k.kind !== want) err(`${ep}.itemId`, `A ${kind} plan can only use ${want} items`);
          else itemRef = { id: k.id };
        } else if (typeof e.item === 'string' && e.item.trim()) {
          const key = norm(e.item);
          const inImport = keys.get(key);
          const inLib = library.filter((x) => norm(x.title) === key && x.kind === want);
          if (inImport) {
            if (inImport.kind !== want) err(`${ep}.item`, `"${e.item}" is a ${inImport.kind}; a ${kind} plan needs ${want} items`);
            else itemRef = { key };
          } else if (inLib.length) itemRef = { id: inLib[0]!.id };
          else err(`${ep}.item`, `No ${want} called "${e.item}" in this import or the library. Add it to "items" first`);
        } else err(`${ep}.item`, 'is required (item title, or itemId)');
        entries.push({
          section, itemRef: itemRef ?? { key: '' },
          sets: num(e.sets, `${ep}.sets`, 1, 20, true),
          reps: e.reps === undefined || e.reps === null ? null : text(String(e.reps), `${ep}.reps`, 20),
          seconds: num(e.seconds, `${ep}.seconds`, 1, 7200, true),
          restSeconds: num(e.rest ?? e.restSeconds, `${ep}.rest`, 0, 1800, true),
          servings: num(e.servings, `${ep}.servings`, 0.1, 20),
          note: text(e.note, `${ep}.note`, 300),
        });
      });
    }
    plans.push({ id: typeof raw.id === 'number' ? raw.id : undefined, kind, title, description: text(raw.description, at(p, 'description'), RLIMITS.description), visibility: visibility(raw.visibility, at(p, 'visibility')), entries });
  });

  return { errors, warnings, draft: errors.length ? null : { items, plans } };
}

// ---------- export ----------
export function itemToJson(it: RoutineItem) {
  const common = {
    id: it.id, kind: it.kind, title: it.title, ...(it.description ? { description: it.description } : {}),
    ...(it.images.length ? { images: it.images } : {}), ...(it.links.length ? { links: it.links } : {}), visibility: it.visibility,
  };
  if (it.kind === 'exercise') {
    const d = it.data;
    return { ...common, instructions: it.bodyMd, muscles: d.muscles, ...(d.equipment ? { equipment: d.equipment } : {}),
      ...(d.sets ? { sets: d.sets } : {}), ...(d.reps ? { reps: d.reps } : {}), ...(d.seconds ? { seconds: d.seconds } : {}) };
  }
  const d = it.data;
  return { ...common, mealTypes: d.mealTypes, ...(d.servingNote ? { serving: d.servingNote } : {}), calories: d.calories, protein: d.protein,
    carbs: d.carbs, fat: d.fat, ingredients: d.ingredients, steps: it.bodyMd };
}

export function planToJson(p: RoutinePlan, entries: PlanEntry[], items: Map<number, RoutineItem>) {
  return {
    id: p.id, kind: p.kind, title: p.title, ...(p.description ? { description: p.description } : {}), visibility: p.visibility,
    entries: entries.map((e) => ({
      section: e.section, itemId: e.itemId, item: items.get(e.itemId)?.title,
      ...(e.sets !== null ? { sets: e.sets } : {}), ...(e.reps !== null ? { reps: e.reps } : {}), ...(e.seconds !== null ? { seconds: e.seconds } : {}),
      ...(e.restSeconds !== null ? { rest: e.restSeconds } : {}), ...(e.servings !== null ? { servings: e.servings } : {}), ...(e.note ? { note: e.note } : {}),
    })),
  };
}
