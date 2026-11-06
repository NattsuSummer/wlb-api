import { conflictError, forbiddenError, notFoundError, validationError } from '../../domain/errors';
import { adminUser, isAdmin, publicUser, USERNAME_RE, type Actor, type Role } from '../../domain/user';
import type { Deps } from '../deps';

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw forbiddenError('Admin only');
}

/** Members page: one card per active member, filtered by each member's privacy. */
export class ListMembersUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    const at = this.d.clock.now();
    const cats = await this.d.memberView.categoryIds();
    const members = [];
    for (const u of await this.d.repos.users.list()) members.push(await this.d.memberView.card(u, actor.id, at, cats));
    return { members };
  }
}

export class AdminListUsersUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    requireAdmin(actor);
    return { users: (await this.d.repos.users.list({ includeDisabled: true })).map(adminUser) };
  }
}

export class AdminCreateUserUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, input: { username: string; displayName?: string; password: string; role: Role }) {
    requireAdmin(actor);
    const username = input.username.toLowerCase();
    if (!USERNAME_RE.test(username)) throw validationError('username may only contain a–z, 0–9, _ . -');
    if (input.password.length < 8) throw validationError('Temporary password must be at least 8 characters');
    if (await this.d.repos.users.findByUsername(username)) throw conflictError('username_taken', 'Username already exists');
    // New users start with an empty schedule and all targets at 0 (= not set).
    const user = await this.d.repos.users.create({
      username,
      displayName: input.displayName || username,
      passwordHash: await this.d.passwords.hash(input.password),
      role: input.role,
      mustChangePassword: true,
    });
    return { user: publicUser(user) };
  }
}

export class AdminUpdateUserUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number, patch: { displayName?: string; role?: Role; disabled?: boolean }) {
    requireAdmin(actor);
    const { users, tokens } = this.d.repos;
    const target = await users.findById(id);
    if (!target) throw notFoundError('User not found');
    if (Object.values(patch).every((v) => v === undefined)) throw validationError('Nothing to update');
    if (patch.disabled !== undefined && id === actor.id) throw validationError('You cannot disable your own account');
    const losesAdmin = target.role === 'admin' && (patch.role === 'member' || patch.disabled === true);
    if (losesAdmin && (await users.countActiveAdmins(id)) < 1) throw conflictError('last_admin', 'There must be at least one active admin');
    await users.update(id, patch);
    if (patch.disabled === true) await tokens.deleteForUser(id);
    return { user: publicUser((await users.findById(id))!) };
  }
}

export class AdminResetPasswordUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, id: number, password: string) {
    requireAdmin(actor);
    if (!(await this.d.repos.users.findById(id))) throw notFoundError('User not found');
    if (password.length < 8) throw validationError('password must be at least 8 characters');
    await this.d.repos.users.setPassword(id, await this.d.passwords.hash(password), true);
    await this.d.repos.tokens.deleteForUser(id, { kind: 'session' });
    return { ok: true };
  }
}

export class AdminListTokensUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    requireAdmin(actor);
    return { tokens: await this.d.repos.tokens.listApiTokens() };
  }
}

export class AdminRevokeTokenUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor, tokenId: string) {
    requireAdmin(actor);
    if (!(await this.d.repos.tokens.deleteApiToken(tokenId))) throw notFoundError('Token not found');
    return { ok: true };
  }
}

export { requireAdmin };
