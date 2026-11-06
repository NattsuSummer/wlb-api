// Composition root: wires repositories → services → use cases. Nothing else creates these objects.
import type { Repositories } from './repositories/interfaces';
import { d1Repositories } from './repositories/d1';
import type { D1Database } from './repositories/d1/db';
import { systemClock, type Clock } from './services/clock';
import { MemberViewService } from './services/member-view-service';
import { Pbkdf2PasswordService } from './services/password-service';
import { TokenService } from './services/token-service';
import { AuthenticateUseCase, ChangePasswordUseCase, LoginUseCase, LogoutUseCase } from './usecases/auth';
import {
  CreateTimeCategoryUseCase, DeleteTimeCategoryUseCase, ListCourseCategoriesUseCase, ListTimeCategoriesUseCase, UpdateTimeCategoryUseCase,
} from './usecases/categories';
import type { Deps } from './usecases/deps';
import {
  CreateApiTokenUseCase, GetMeUseCase, GetPrivacyUseCase, ListMyTokensUseCase, RevokeMyTokenUseCase, UpdatePrivacyUseCase, UpdateProfileUseCase,
} from './usecases/me';
import { GetNowUseCase } from './usecases/now';
import {
  ClearRangeUseCase, GetScheduleUseCase, PreviewRangeUseCase, SetCellsUseCase, SetTargetsUseCase, WriteRangeUseCase,
} from './usecases/schedules';
import {
  AdminCreateUserUseCase, AdminListTokensUseCase, AdminListUsersUseCase, AdminResetPasswordUseCase, AdminRevokeTokenUseCase,
  AdminUpdateUserUseCase, ListMembersUseCase,
} from './usecases/users';

const passwords = new Pbkdf2PasswordService(); // stateless; shared across requests

export function buildUseCases(d: Deps) {
  return {
    authenticate: new AuthenticateUseCase(d),
    login: new LoginUseCase(d),
    logout: new LogoutUseCase(d),
    changePassword: new ChangePasswordUseCase(d),

    getMe: new GetMeUseCase(d),
    updateProfile: new UpdateProfileUseCase(d),
    getPrivacy: new GetPrivacyUseCase(d),
    updatePrivacy: new UpdatePrivacyUseCase(d),
    listMyTokens: new ListMyTokensUseCase(d),
    createApiToken: new CreateApiTokenUseCase(d),
    revokeMyToken: new RevokeMyTokenUseCase(d),

    listMembers: new ListMembersUseCase(d),
    adminListUsers: new AdminListUsersUseCase(d),
    adminCreateUser: new AdminCreateUserUseCase(d),
    adminUpdateUser: new AdminUpdateUserUseCase(d),
    adminResetPassword: new AdminResetPasswordUseCase(d),
    adminListTokens: new AdminListTokensUseCase(d),
    adminRevokeToken: new AdminRevokeTokenUseCase(d),

    listTimeCategories: new ListTimeCategoriesUseCase(d),
    createTimeCategory: new CreateTimeCategoryUseCase(d),
    updateTimeCategory: new UpdateTimeCategoryUseCase(d),
    deleteTimeCategory: new DeleteTimeCategoryUseCase(d),
    listCourseCategories: new ListCourseCategoriesUseCase(d),

    getSchedule: new GetScheduleUseCase(d),
    previewRange: new PreviewRangeUseCase(d),
    writeRange: new WriteRangeUseCase(d),
    clearRange: new ClearRangeUseCase(d),
    setCells: new SetCellsUseCase(d),
    setTargets: new SetTargetsUseCase(d),

    getNow: new GetNowUseCase(d),
  };
}

/** Build the dependency graph from any set of repositories (D1 in production, in-memory fakes in tests). */
export function createContainer(repos: Repositories, clock: Clock = systemClock) {
  const deps: Deps = {
    repos,
    passwords,
    clock,
    tokens: new TokenService(repos.tokens, clock),
    memberView: new MemberViewService(repos.schedules, repos.privacy, repos.timeCategories),
  };
  return { deps, usecases: buildUseCases(deps) };
}

export const d1Container = (db: D1Database, clock?: Clock) => createContainer(d1Repositories(db), clock);

export type Container = ReturnType<typeof createContainer>;
