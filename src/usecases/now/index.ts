import { bangkokNow } from '../../domain/time';
import type { Actor } from '../../domain/user';
import type { Deps } from '../deps';
import { todaysRoutines } from '../routines';
import { bodyCheck } from '../body';
import { projectsToday } from '../projects';

/** Home page: what is planned right now for me and for everyone I'm allowed to see. */
export class GetNowUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    const at = this.d.clock.now();
    const cats = await this.d.memberView.categoryIds();
    const cards = [];
    for (const u of await this.d.repos.users.list()) cards.push(await this.d.memberView.card(u, actor.id, at, cats));
    return {
      routinesToday: await todaysRoutines(this.d, actor, at),
      bodyCheck: await bodyCheck(this.d, actor, at),
      projectsToday: await projectsToday(this.d, actor, at),
      at: at.toISOString(),
      bangkok: bangkokNow(at),
      me: cards.find((c) => c.isMe) ?? null,
      others: cards.filter((c) => !c.isMe),
    };
  }
}
