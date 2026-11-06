import { lockedError, unauthorizedError, validationError } from '../../domain/errors';
import { LOCK_MINUTES, MAX_FAILED_LOGINS, passwordProblems, SESSION_DAYS_REMEMBER, SESSION_DAYS_SHORT } from '../../domain/password-policy';
import { selfUser, type Actor } from '../../domain/user';
import type { Deps } from '../deps';

export class LoginUseCase {
  constructor(private d: Deps) {}

  async execute(input: { username: string; password: string; remember: boolean }) {
    const { users } = this.d.repos;
    const now = this.d.clock.now();
    const cred = await users.credentialsByUsername(input.username);

    if (cred?.lockedUntil && Date.parse(cred.lockedUntil) > now.getTime()) {
      throw lockedError('Too many failed attempts. Try again in a few minutes.');
    }
    const ok = cred ? await this.d.passwords.verify(input.password, cred.passwordHash) : await this.d.passwords.verifyDummy(input.password);
    if (!cred || !ok || cred.disabled) {
      if (cred && !ok) {
        const fails = cred.failedLogins + 1;
        const locked = fails >= MAX_FAILED_LOGINS;
        await users.recordFailedLogin(cred.id, locked ? 0 : fails, locked ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null);
      }
      throw unauthorizedError('Username or password is incorrect', 'invalid_credentials');
    }

    await users.recordSuccessfulLogin(cred.id, now.toISOString());
    const session = await this.d.tokens.issue(cred.id, 'session', { days: input.remember ? SESSION_DAYS_REMEMBER : SESSION_DAYS_SHORT });
    const user = await users.findById(cred.id);
    return { token: session.token, expiresAt: session.expiresAt, user: selfUser(user!) };
  }
}

export class LogoutUseCase {
  constructor(private d: Deps) {}
  async execute(actor: Actor) {
    await this.d.repos.tokens.delete(actor.tokenId);
    return { ok: true };
  }
}

/** Change own password — also the forced change after the first login. Signs out other devices. */
export class ChangePasswordUseCase {
  constructor(private d: Deps) {}

  async execute(actor: Actor, input: { currentPassword: string; newPassword: string }) {
    const cred = await this.d.repos.users.credentialsById(actor.id);
    if (!cred || !(await this.d.passwords.verify(input.currentPassword, cred.passwordHash))) {
      throw unauthorizedError('Current password is incorrect', 'invalid_credentials');
    }
    const problems = passwordProblems(input.newPassword, { forbid: [input.currentPassword] });
    if (problems.length) throw validationError('New password does not meet the rules', { problems });
    await this.d.repos.users.setPassword(actor.id, await this.d.passwords.hash(input.newPassword), false);
    await this.d.repos.tokens.deleteForUser(actor.id, { kind: 'session', exceptId: actor.tokenId });
    return { ok: true };
  }
}

export class AuthenticateUseCase {
  constructor(private d: Deps) {}
  /** Authorization header value → actor (or null when missing/invalid). */
  async execute(authorization: string | null): Promise<Actor | null> {
    const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    return m ? this.d.tokens.resolve(m[1]!) : null;
  }
}
