// Body stats are private: every use case works on the signed-in user's own data only.
import { bangkokDate, bodySummary, parseDate, parseEntry, parseGoal } from '../../domain/body';
import { notFoundError } from '../../domain/errors';
import type { Actor } from '../../domain/user';
import type { Deps } from '../deps';

export class GetBodyStatsUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor) {
    const today = bangkokDate(this.d.clock.now());
    const [entries, goal] = await Promise.all([this.d.repos.body.entries(a.id), this.d.repos.body.goal(a.id)]);
    return { today, entries, goal, summary: bodySummary(entries, goal, today) };
  }
}

export class SaveBodyEntryUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, date: unknown, body: Record<string, unknown>) {
    const today = bangkokDate(this.d.clock.now());
    const entry = parseEntry(parseDate(date, today), body);
    await this.d.repos.body.upsertEntry(a.id, entry);
    return new GetBodyStatsUseCase(this.d).execute(a);
  }
}

export class DeleteBodyEntryUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, date: unknown) {
    const day = parseDate(date, '9999-12-31');
    if (!(await this.d.repos.body.deleteEntry(a.id, day))) throw notFoundError('No entry on that date');
    return new GetBodyStatsUseCase(this.d).execute(a);
  }
}

export class SetBodyGoalUseCase {
  constructor(private d: Deps) {}
  async execute(a: Actor, body: Record<string, unknown>) {
    await this.d.repos.body.setGoal(a.id, parseGoal(body));
    return new GetBodyStatsUseCase(this.d).execute(a);
  }
}

/** Small reminder for the home page. */
export async function bodyCheck(d: Deps, a: Actor, at: Date) {
  const today = bangkokDate(at);
  const last = await d.repos.body.lastEntry(a.id);
  const s = bodySummary(last ? [last] : [], { targetWeightKg: null }, today);
  return { due: s.due, lastDate: last?.date ?? null, daysSinceLast: s.daysSinceLast, weightKg: last?.weightKg ?? null };
}
