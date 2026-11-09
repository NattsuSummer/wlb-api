// Routine use cases: library (exercises, meals), plans, import/export, and linking plans to days / hour slots.
import { canEditCourse as canEdit, canViewCourse as canView, inCatalog, type CourseStatus, type Visibility } from '../../domain/course';
import { conflictError, forbiddenError, notFoundError, validationError } from '../../domain/errors';
import {
  itemToJson, mealTotals, planToJson, validateRoutines, workoutMinutes,
  type ItemDraft, type PlanDraft, type PlanEntry, type RoutineItem, type RoutinePlan,
} from '../../domain/routine';
import { routineGuideMarkdown } from '../../domain/routine-guide';
import { bangkokNow } from '../../domain/time';
import type { Actor } from '../../domain/user';
import type { ItemWrite, PlanWrite } from '../../repositories/interfaces';
import type { Deps } from '../deps';

abstract class RoutineUseCase {
  constructor(protected d: Deps) {}

  protected async viewableItem(id: number, a: Actor) {
    const it = await this.d.repos.routines.findItem(id);
    if (!it || !canView(it, a)) throw notFoundError('Item not found');
    return it;
  }
  protected async editableItem(id: number, a: Actor) {
    const it = await this.viewableItem(id, a);
    if (!canEdit(it, a)) throw forbiddenError('Only the creator or an admin can change this');
    return it;
  }
  protected async viewablePlan(id: number, a: Actor) {
    const p = await this.d.repos.routines.findPlan(id);
    if (!p || !canView(p, a)) throw notFoundError('Plan not found');
    return p;
  }
  protected async editablePlan(id: number, a: Actor) {
    const p = await this.viewablePlan(id, a);
    if (!canEdit(p, a)) throw forbiddenError('Only the creator or an admin can change this plan');
    return p;
  }

  /** Items the actor may put into plans (and refer to by title in imports). */
  protected async library(a: Actor) {
    return (await this.d.repos.routines.listItems()).filter((i) => canView(i, a));
  }

  protected async validate(input: unknown, a: Actor) {
    return validateRoutines(input, await this.library(a));
  }

  protected async validOrThrow(input: unknown, a: Actor) {
    const v = await this.validate(input, a);
    if (!v.draft) throw validationError(`Found ${v.errors.length} problem(s)`, { errors: v.errors, warnings: v.warnings }, 'invalid_routine');
    return { draft: v.draft, warnings: v.warnings };
  }

  protected itemWrite(i: ItemDraft, status: CourseStatus): ItemWrite {
    return { kind: i.kind, title: i.title, description: i.description, bodyMd: i.bodyMd, images: i.images, links: i.links, visibility: i.visibility, status, data: i.data };
  }

  protected planWrite(p: PlanDraft, status: CourseStatus, keyToId: Map<string, number>): PlanWrite {
    return {
      kind: p.kind, title: p.title, description: p.description, visibility: p.visibility, status,
      entries: p.entries.map((e) => ({
        section: e.section, itemId: 'id' in e.itemRef ? e.itemRef.id : keyToId.get(e.itemRef.key)!,
        sets: e.sets, reps: e.reps, seconds: e.seconds, restSeconds: e.restSeconds, servings: e.servings, note: e.note,
      })),
    };
  }

  protected planSummary(p: RoutinePlan, entries: PlanEntry[], items: Map<number, RoutineItem>, a: Actor) {
    const muscles = new Set<string>();
    for (const e of entries) {
      const it = items.get(e.itemId);
      if (it?.kind === 'exercise') it.data.muscles.forEach((m) => muscles.add(m));
    }
    return {
      ...p,
      entryCount: entries.length,
      totals: p.kind === 'meal' ? mealTotals(entries, items) : undefined,
      minutes: p.kind === 'workout' ? workoutMinutes(entries) : undefined,
      muscles: p.kind === 'workout' ? [...muscles] : undefined,
      mine: p.createdBy === a.id,
      canEdit: canEdit(p, a),
    };
  }
}

export class ListRoutinesUseCase extends RoutineUseCase {
  async execute(a: Actor) {
    const r = this.d.repos.routines;
    const [allItems, plans, entries, assignments, users] = await Promise.all([r.listItems(), r.listPlans(), r.allEntries(), r.assignments(a.id), this.d.repos.users.list()]);
    const items = new Map(allItems.map((i) => [i.id, i]));
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    const usage = new Map<number, number>();
    for (const e of entries) usage.set(e.itemId, (usage.get(e.itemId) ?? 0) + 1);
    const visiblePlans = plans.filter((p) => inCatalog(p, a));
    return {
      items: allItems.filter((i) => inCatalog(i, a)).map((i) => ({
        ...i, bodyMd: undefined, usedIn: usage.get(i.id) ?? 0, creatorName: names.get(i.createdBy ?? -1) ?? null, mine: i.createdBy === a.id, canEdit: canEdit(i, a),
      })),
      plans: visiblePlans.map((p) => ({
        ...this.planSummary(p, entries.filter((e) => e.planId === p.id), items, a),
        creatorName: names.get(p.createdBy ?? -1) ?? null,
        myDays: assignments.filter((x) => x.planId === p.id).map(({ weekday, hour }) => ({ weekday, hour })),
      })),
    };
  }
}

/** My week: plans linked to days / hours (for the routines page, the schedule and the home page). */
export class GetMyRoutineWeekUseCase extends RoutineUseCase {
  async execute(a: Actor) {
    const r = this.d.repos.routines;
    const [assignments, plans, entries, allItems] = await Promise.all([r.assignments(a.id), r.listPlans(), r.allEntries(), r.listItems()]);
    const items = new Map(allItems.map((i) => [i.id, i]));
    const byId = new Map(plans.filter((p) => canView(p, a)).map((p) => [p.id, p]));
    return {
      links: assignments.filter((x) => byId.has(x.planId)).map((x) => {
        const p = byId.get(x.planId)!;
        const s = this.planSummary(p, entries.filter((e) => e.planId === p.id), items, a);
        return { weekday: x.weekday, hour: x.hour, plan: { id: p.id, kind: p.kind, title: p.title, entryCount: s.entryCount, minutes: s.minutes, calories: s.totals?.calories } };
      }),
    };
  }
}

export class GetRoutineItemUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number) {
    const it = await this.viewableItem(id, a);
    const [plans, entries] = await Promise.all([this.d.repos.routines.listPlans(), this.d.repos.routines.allEntries()]);
    const planIds = new Set(entries.filter((e) => e.itemId === id).map((e) => e.planId));
    return {
      item: { ...it, mine: it.createdBy === a.id, canEdit: canEdit(it, a) },
      usedIn: plans.filter((p) => planIds.has(p.id) && inCatalog(p, a)).map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
    };
  }
}

export class GetRoutinePlanUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number) {
    const p = await this.viewablePlan(id, a);
    const [entries, allItems, assignments] = await Promise.all([this.d.repos.routines.entries(id), this.d.repos.routines.listItems(), this.d.repos.routines.assignments(a.id)]);
    const items = new Map(allItems.map((i) => [i.id, i]));
    return {
      plan: this.planSummary(p, entries, items, a),
      entries: entries.map((e) => {
        const it = items.get(e.itemId)!;
        return {
          ...e,
          item: { id: it.id, kind: it.kind, title: it.title, description: it.description, data: it.data, image: it.images[0] ?? null, viewable: canView(it, a) },
        };
      }),
      myDays: assignments.filter((x) => x.planId === id).map(({ weekday, hour }) => ({ weekday, hour })),
    };
  }
}

export class ValidateRoutinesUseCase extends RoutineUseCase {
  async execute(a: Actor, input: unknown) {
    return this.validate(input, a);
  }
}

/** Create items and plans from the import format. API-token / AI imports start as drafts unless told otherwise. */
export class ImportRoutinesUseCase extends RoutineUseCase {
  async execute(a: Actor, input: unknown, opts: { status?: CourseStatus } = {}) {
    const { draft, warnings } = await this.validOrThrow(input, a);
    const status = opts.status ?? (a.tokenKind === 'api' ? 'draft' : 'published');
    const keyToId = new Map<string, number>();
    const items = [];
    for (const i of draft.items) {
      const id = await this.d.repos.routines.createItem(this.itemWrite(i, status), a.id);
      keyToId.set(i.key, id);
      items.push({ id, kind: i.kind, title: i.title });
    }
    const plans = [];
    for (const p of draft.plans) {
      const id = await this.d.repos.routines.createPlan(this.planWrite(p, status, keyToId), a.id);
      plans.push({ id, kind: p.kind, title: p.title });
    }
    return { items, plans, status, warnings };
  }
}

export class UpdateRoutineItemUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number, input: unknown) {
    const cur = await this.editableItem(id, a);
    const body = typeof input === 'object' && input !== null ? { ...(input as object), kind: cur.kind } : input;
    const { draft, warnings } = await this.validOrThrow(body, a);
    if (draft.items.length !== 1 || draft.plans.length) throw validationError('Send one item');
    await this.d.repos.routines.updateItem(id, this.itemWrite(draft.items[0]!, cur.status));
    return { id, warnings };
  }
}

export class UpdateRoutinePlanUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number, input: unknown) {
    const cur = await this.editablePlan(id, a);
    const body = typeof input === 'object' && input !== null ? { ...(input as object), kind: cur.kind, entries: (input as { entries?: unknown }).entries ?? [] } : input;
    const { draft, warnings } = await this.validOrThrow(body, a);
    if (draft.plans.length !== 1 || draft.items.length) throw validationError('Send one plan');
    await this.d.repos.routines.replacePlan(id, this.planWrite(draft.plans[0]!, cur.status, new Map()));
    return { id, warnings };
  }
}

export class PatchRoutineUseCase extends RoutineUseCase {
  async execute(a: Actor, what: 'item' | 'plan', id: number, patch: { visibility?: Visibility; status?: CourseStatus }) {
    if (what === 'item') { await this.editableItem(id, a); await this.d.repos.routines.patchItem(id, patch); }
    else { await this.editablePlan(id, a); await this.d.repos.routines.patchPlan(id, patch); }
    return { ok: true };
  }
}

export class DeleteRoutineUseCase extends RoutineUseCase {
  async execute(a: Actor, what: 'item' | 'plan', id: number) {
    if (what === 'item') {
      await this.editableItem(id, a);
      const used = await this.d.repos.routines.itemUsage(id);
      if (used) throw conflictError('item_in_use', `This item is used in ${used} plan entr${used === 1 ? 'y' : 'ies'}. Remove it from those plans first.`, { used });
      await this.d.repos.routines.deleteItem(id);
    } else {
      await this.editablePlan(id, a);
      await this.d.repos.routines.deletePlan(id);
    }
    return { ok: true };
  }
}

/** A plan with the items it uses, in the import format (re-importable). */
export class ExportRoutinePlanUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number) {
    const p = await this.viewablePlan(id, a);
    const [entries, allItems] = await Promise.all([this.d.repos.routines.entries(id), this.d.repos.routines.listItems()]);
    const items = new Map(allItems.map((i) => [i.id, i]));
    const used = [...new Set(entries.map((e) => e.itemId))].map((i) => items.get(i)!).filter((i) => canView(i, a));
    return { items: used.map(itemToJson), plans: [planToJson(p, entries, items)] };
  }
}

export class ExportRoutineItemUseCase extends RoutineUseCase {
  async execute(a: Actor, id: number) {
    return itemToJson(await this.viewableItem(id, a));
  }
}

export class SetRoutineDaysUseCase extends RoutineUseCase {
  async execute(a: Actor, planId: number, slots: { weekday: number; hour: number | null }[]) {
    await this.viewablePlan(planId, a);
    const seen = new Set<string>();
    const clean = slots.filter((s) => {
      const k = `${s.weekday}:${s.hour}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await this.d.repos.routines.setAssignments(a.id, planId, clean);
    return { myDays: clean };
  }
}

export class GetRoutineGuideUseCase {
  constructor(private d: Deps) {}
  execute() {
    return routineGuideMarkdown();
  }
}

/** Today's linked plans for the home page. */
export async function todaysRoutines(d: Deps, a: Actor, at: Date) {
  const { links } = await new GetMyRoutineWeekUseCase(d).execute(a);
  const now = bangkokNow(at);
  return links.filter((l) => l.weekday === now.weekday).map((l) => ({ ...l, current: l.hour === now.hour }));
}

