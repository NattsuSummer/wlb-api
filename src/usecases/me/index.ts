import { notFoundError, validationError } from '../../domain/errors';
import type { Privacy } from '../../domain/privacy';
import { selfUser, type Actor } from '../../domain/user';
import type { UserPatch } from '../../repositories/interfaces';
import type { Deps } from '../deps';

export class GetMeUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    const u = await this.d.repos.users.findById(actor.id);
    if (!u) throw notFoundError();
    return { user: selfUser(u), privacy: await this.d.repos.privacy.load(actor.id) };
  }
}

export class UpdateProfileUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, patch: Pick<UserPatch, 'displayName' | 'locale' | 'theme' | 'avatarColor'>) {
    if (Object.values(patch).every((v) => v === undefined)) throw validationError('Nothing to update');
    await this.d.repos.users.update(actor.id, patch);
    return { user: selfUser((await this.d.repos.users.findById(actor.id))!) };
  }
}

export class GetPrivacyUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    return { privacy: await this.d.repos.privacy.load(actor.id) };
  }
}

export class UpdatePrivacyUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, p: Privacy) {
    await this.d.repos.privacy.save(actor.id, p);
    return { privacy: p };
  }
}

export class ListMyTokensUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    return { tokens: await this.d.repos.tokens.listApiTokens(actor.id) };
  }
}

export class CreateApiTokenUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, name: string) {
    if (actor.tokenKind !== 'session') throw validationError('Create API tokens from a logged-in session');
    const t = await this.d.tokens.issue(actor.id, 'api', { name });
    return { token: t.token, id: t.id, name };
  }
}

export class RevokeMyTokenUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, tokenId: string) {
    if (!(await this.d.repos.tokens.deleteApiToken(tokenId, actor.id))) throw notFoundError('Token not found');
    return { ok: true };
  }
}
