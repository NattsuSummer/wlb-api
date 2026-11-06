import { conflictError, forbiddenError, notFoundError, validationError } from '../../domain/errors';
import { normalizeSlot, planRange, targetsProblem, type RangeInput, type Slot, type Week } from '../../domain/schedule';
import { slotIndex } from '../../domain/time';
import { isAdmin, publicUser, type Actor } from '../../domain/user';
import type { Deps } from '../deps';

export interface SlotInput { categoryIds: number[]; description: string }
export interface CellInput { weekday: number; hour: number; slot: SlotInput | null }

/** Shared checks for every schedule use case. */
abstract class ScheduleUseCase {
  constructor(protected d: Deps) {}

  protected async owner(userId: number) {
    const u = await this.d.repos.users.findById(userId);
    if (!u || u.disabled) throw notFoundError('User not found');
    return u;
  }

  /** Only the owner or an admin may change a schedule. */
  protected assertCanEdit(actor: Actor, ownerId: number) {
    if (actor.id !== ownerId && !isAdmin(actor)) throw forbiddenError('You can only change your own data');
  }

  protected async slot(input: SlotInput): Promise<Slot> {
    const valid = new Set((await this.d.repos.timeCategories.list()).map((c) => c.id));
    const bad = input.categoryIds.filter((id) => !valid.has(id));
    if (bad.length) throw validationError(`Unknown category id(s): ${bad.join(', ')}`);
    return normalizeSlot(input.categoryIds, input.description);
  }

  protected view(ownerId: number, actor: Actor) {
    return this.d.memberView.schedule(ownerId, actor.id);
  }
}

const cellsOf = (week: Week, r: RangeInput) => {
  const out: { weekday: number; hour: number; slot: Slot | null }[] = [];
  for (const d of r.days) for (let h = r.from; h < r.to; h++) out.push({ weekday: d, hour: h, slot: week[slotIndex(d, h)] ?? null });
  return out;
};

export class GetScheduleUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number) {
    const u = await this.owner(userId);
    return { user: publicUser(u), editable: actor.id === u.id || isAdmin(actor), ...(await this.view(u.id, actor)) };
  }
}

/** Dry run: what would change? Feeds the overwrite warning and the before/after preview. */
export class PreviewRangeUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number, range: RangeInput, value: SlotInput | null) {
    const u = await this.owner(userId);
    this.assertCanEdit(actor, u.id);
    const slot = value ? await this.slot(value) : null;
    const plan = planRange(await this.d.repos.schedules.loadWeek(u.id), range, slot);
    return { overwrites: plan.overwrites, overwriteCount: plan.overwriteCount, fillCount: plan.fillCount, unchangedCount: plan.unchangedCount };
  }
}

/** Write one value to a range. Replacing planned hours needs confirmOverwrite. Returns undo cells. */
export class WriteRangeUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number, range: RangeInput, value: SlotInput, confirmOverwrite: boolean) {
    const u = await this.owner(userId);
    this.assertCanEdit(actor, u.id);
    const slot = await this.slot(value);
    const week = await this.d.repos.schedules.loadWeek(u.id);
    const plan = planRange(week, range, slot);
    if (plan.overwriteCount > 0 && !confirmOverwrite) {
      throw conflictError('overwrite_needs_confirm', `This replaces ${plan.overwriteCount} planned hour(s)`, { overwrites: plan.overwrites, overwriteCount: plan.overwriteCount });
    }
    const undo = cellsOf(week, range);
    await this.d.repos.schedules.saveCells(u.id, cellsOf(plan.after, range));
    return { undo, overwriteCount: plan.overwriteCount, fillCount: plan.fillCount, ...(await this.view(u.id, actor)) };
  }
}

/** Clear a range (the editor sends the block that was picked, not the edited range). */
export class ClearRangeUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number, range: RangeInput) {
    const u = await this.owner(userId);
    this.assertCanEdit(actor, u.id);
    const undo = cellsOf(await this.d.repos.schedules.loadWeek(u.id), range);
    await this.d.repos.schedules.saveCells(u.id, undo.map((c) => ({ ...c, slot: null })));
    return { undo, clearedCount: undo.filter((c) => c.slot !== null).length, ...(await this.view(u.id, actor)) };
  }
}

/** Set exact cells — used by "undo". */
export class SetCellsUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number, cells: CellInput[]) {
    const u = await this.owner(userId);
    this.assertCanEdit(actor, u.id);
    const valid = new Set((await this.d.repos.timeCategories.list()).map((c) => c.id));
    const out = cells.map((c, i) => {
      if (!c.slot) return { weekday: c.weekday, hour: c.hour, slot: null };
      if (c.slot.categoryIds.some((id) => !valid.has(id))) throw validationError(`cells[${i}] has an unknown category`);
      return { weekday: c.weekday, hour: c.hour, slot: normalizeSlot(c.slot.categoryIds, c.slot.description) };
    });
    await this.d.repos.schedules.saveCells(u.id, out);
    return this.view(u.id, actor);
  }
}

/** Targets must be all 0 ("not set") or add up to 100. */
export class SetTargetsUseCase extends ScheduleUseCase {
  async execute(actor: Actor, userId: number, targets: Record<number, number>) {
    const u = await this.owner(userId);
    this.assertCanEdit(actor, u.id);
    const valid = new Set((await this.d.repos.timeCategories.list()).map((c) => c.id));
    const unknown = Object.keys(targets).filter((k) => !valid.has(Number(k)));
    if (unknown.length) throw validationError(`Unknown category id: ${unknown[0]}`);
    const problem = targetsProblem(targets);
    if (problem) throw validationError(problem);
    await this.d.repos.schedules.saveTargets(u.id, targets);
    return this.view(u.id, actor);
  }
}
