import type { Repositories } from '../repositories/interfaces';
import type { Clock } from '../services/clock';
import type { MemberViewService } from '../services/member-view-service';
import type { Pbkdf2PasswordService } from '../services/password-service';
import type { TokenService } from '../services/token-service';

/** Everything a use case may depend on. Built once per request in src/container.ts. */
export interface Deps {
  repos: Repositories;
  passwords: Pbkdf2PasswordService;
  tokens: TokenService;
  clock: Clock;
  memberView: MemberViewService;
}
