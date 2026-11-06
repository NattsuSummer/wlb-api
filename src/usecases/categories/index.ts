import { conflictError, notFoundError, validationError } from '../../domain/errors';
import { HEX_COLOR_RE, type Actor } from '../../domain/user';
import type { Deps } from '../deps';
import { requireAdmin } from '../users';

export class ListTimeCategoriesUseCase {
  constructor(private d: Deps) {}
  async execute() {
    const [cats, usage] = [await this.d.repos.timeCategories.list(), await this.d.repos.timeCategories.usage()];
    return { categories: cats.map((c) => ({ ...c, usedSlots: usage.get(c.id) ?? 0 })) };
  }
}

export class CreateTimeCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, input: { nameTh: string; nameEn?: string; color: string }) {
    requireAdmin(actor);
    if (!HEX_COLOR_RE.test(input.color)) throw validationError('color must be #RRGGBB');
    const id = await this.d.repos.timeCategories.create({ nameTh: input.nameTh, nameEn: input.nameEn || input.nameTh, color: input.color.toUpperCase() });
    return { id };
  }
}

export class UpdateTimeCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number, patch: { nameTh?: string; nameEn?: string; color?: string; sort?: number }) {
    requireAdmin(actor);
    if (Object.values(patch).every((v) => v === undefined)) throw validationError('Nothing to update');
    if (patch.color !== undefined && !HEX_COLOR_RE.test(patch.color)) throw validationError('color must be #RRGGBB');
    const ok = await this.d.repos.timeCategories.update(id, { ...patch, color: patch.color?.toUpperCase() });
    if (!ok) throw notFoundError('Category not found');
    return { ok: true };
  }
}

/** A category still used by any slot cannot be deleted. */
export class DeleteTimeCategoryUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number) {
    requireAdmin(actor);
    const used = await this.d.repos.timeCategories.usageOf(id);
    if (used > 0) throw conflictError('category_in_use', `Category is used by ${used} slot(s). Move them to another category first.`, { usedSlots: used });
    if (!(await this.d.repos.timeCategories.delete(id))) throw notFoundError('Category not found');
    return { ok: true };
  }
}

export class ListCourseCategoriesUseCase {
  constructor(private d: Deps) {}
  async execute() {
    return { categories: await this.d.repos.courseCategories.list() };
  }
}
