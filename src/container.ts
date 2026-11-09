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
import {
  AdminListCoursesUseCase, AttemptExerciseUseCase, CreateCourseCategoryUseCase, CreatePackUseCase, DeleteCourseCategoryUseCase, DeleteCourseUseCase,
  DeletePackUseCase, ExportCourseUseCase, GetCourseUseCase, GetImportGuideUseCase, GetLessonUseCase, ImportCourseUseCase, ListCatalogUseCase,
  ListPacksUseCase, PatchCourseUseCase, SetLessonCompleteUseCase, UpdateCourseCategoryUseCase, UpdateCourseUseCase, UpdatePackUseCase, ValidateCourseUseCase,
} from './usecases/courses';
import type { AppConfig, Deps } from './usecases/deps';
import { McpUseCase } from './usecases/mcp';
import {
  DeleteRoutineUseCase, ExportRoutineItemUseCase, ExportRoutinePlanUseCase, GetMyRoutineWeekUseCase, GetRoutineGuideUseCase, GetRoutineItemUseCase,
  GetRoutinePlanUseCase, ImportRoutinesUseCase, ListRoutinesUseCase, PatchRoutineUseCase, SetRoutineDaysUseCase, UpdateRoutineItemUseCase,
  UpdateRoutinePlanUseCase, ValidateRoutinesUseCase,
} from './usecases/routines';
import { DecideConsentUseCase, GetConsentUseCase, RegisterClientUseCase, StartAuthorizeUseCase, TokenUseCase } from './usecases/oauth';
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

    listCatalog: new ListCatalogUseCase(d),
    adminListCourses: new AdminListCoursesUseCase(d),
    getCourse: new GetCourseUseCase(d),
    getLesson: new GetLessonUseCase(d),
    setLessonComplete: new SetLessonCompleteUseCase(d),
    attemptExercise: new AttemptExerciseUseCase(d),
    validateCourse: new ValidateCourseUseCase(d),
    importCourse: new ImportCourseUseCase(d),
    updateCourse: new UpdateCourseUseCase(d),
    patchCourse: new PatchCourseUseCase(d),
    deleteCourse: new DeleteCourseUseCase(d),
    exportCourse: new ExportCourseUseCase(d),
    getImportGuide: new GetImportGuideUseCase(d),
    listPacks: new ListPacksUseCase(d),
    createPack: new CreatePackUseCase(d),
    updatePack: new UpdatePackUseCase(d),
    deletePack: new DeletePackUseCase(d),
    createCourseCategory: new CreateCourseCategoryUseCase(d),
    updateCourseCategory: new UpdateCourseCategoryUseCase(d),
    deleteCourseCategory: new DeleteCourseCategoryUseCase(d),

    oauthRegister: new RegisterClientUseCase(d),
    oauthStart: new StartAuthorizeUseCase(d),
    oauthConsent: new GetConsentUseCase(d),
    oauthDecide: new DecideConsentUseCase(d),
    oauthToken: new TokenUseCase(d),
    mcp: new McpUseCase(d),

    listRoutines: new ListRoutinesUseCase(d),
    myRoutineWeek: new GetMyRoutineWeekUseCase(d),
    getRoutineItem: new GetRoutineItemUseCase(d),
    getRoutinePlan: new GetRoutinePlanUseCase(d),
    validateRoutines: new ValidateRoutinesUseCase(d),
    importRoutines: new ImportRoutinesUseCase(d),
    updateRoutineItem: new UpdateRoutineItemUseCase(d),
    updateRoutinePlan: new UpdateRoutinePlanUseCase(d),
    patchRoutine: new PatchRoutineUseCase(d),
    deleteRoutine: new DeleteRoutineUseCase(d),
    exportRoutinePlan: new ExportRoutinePlanUseCase(d),
    exportRoutineItem: new ExportRoutineItemUseCase(d),
    setRoutineDays: new SetRoutineDaysUseCase(d),
    getRoutineGuide: new GetRoutineGuideUseCase(d),
  };
}

/** Build the dependency graph from any set of repositories (D1 in production, in-memory fakes in tests). */
export const DEFAULT_CONFIG: AppConfig = { webUrl: 'https://balance-our-day.pages.dev' };

export function createContainer(repos: Repositories, clock: Clock = systemClock, config: AppConfig = DEFAULT_CONFIG) {
  const deps: Deps = {
    repos,
    passwords,
    clock,
    tokens: new TokenService(repos.tokens, clock),
    config,
    memberView: new MemberViewService(repos.schedules, repos.privacy, repos.timeCategories, repos.courses, repos.progress),
  };
  return { deps, usecases: buildUseCases(deps) };
}

export const d1Container = (db: D1Database, clock?: Clock, config?: AppConfig) => createContainer(d1Repositories(db), clock, config);

export type Container = ReturnType<typeof createContainer>;
