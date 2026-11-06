// Repository contracts. Use cases depend on these interfaces only; d1/* implements them for Cloudflare D1.
import type { ApiTokenInfo, CourseCategory, TimeCategory } from '../domain/category';
import type { Course, CourseDraft, CourseStatus, CourseSummary, Exercise, Lesson, Pack, Visibility } from '../domain/course';
import type { OAuthClient } from '../domain/oauth';
import type { Privacy } from '../domain/privacy';
import type { Slot, Week } from '../domain/schedule';
import type { Actor, Locale, Role, Theme, User, UserCredentials } from '../domain/user';

export interface NewUser {
  username: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  avatarColor?: string | null;
  mustChangePassword: boolean;
}

export interface UserPatch {
  displayName?: string;
  role?: Role;
  locale?: Locale;
  theme?: Theme;
  avatarColor?: string;
  disabled?: boolean;
}

export interface UserRepository {
  findById(id: number): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  credentialsByUsername(username: string): Promise<UserCredentials | null>;
  credentialsById(id: number): Promise<UserCredentials | null>;
  list(opts?: { includeDisabled?: boolean }): Promise<User[]>;
  create(u: NewUser): Promise<User>;
  update(id: number, patch: UserPatch): Promise<void>;
  countActiveAdmins(exceptId?: number): Promise<number>;
  recordFailedLogin(id: number, failedLogins: number, lockedUntil: string | null): Promise<void>;
  recordSuccessfulLogin(id: number, at: string): Promise<void>;
  /** Set a new hash; mustChange = true for admin resets, false when the user changes it. */
  setPassword(id: number, passwordHash: string, mustChange: boolean): Promise<void>;
}

export interface NewToken {
  id: string; // sha256 of the token
  userId: number;
  kind: 'session' | 'api';
  name: string | null;
  hint: string;
  expiresAt: string | null;
}

export interface TokenRepository {
  create(t: NewToken): Promise<void>;
  /** Resolve a token hash to the acting user (null if unknown, expired or disabled). */
  findActor(tokenId: string, now: Date): Promise<(Actor & { lastUsedAt: string | null }) | null>;
  touch(tokenId: string, at: string): Promise<void>;
  delete(tokenId: string): Promise<void>;
  deleteForUser(userId: number, opts?: { kind?: 'session' | 'api'; exceptId?: string }): Promise<void>;
  listApiTokens(userId?: number): Promise<ApiTokenInfo[]>;
  deleteApiToken(tokenId: string, userId?: number): Promise<boolean>;
}

export interface TimeCategoryRepository {
  list(): Promise<TimeCategory[]>;
  usage(): Promise<Map<number, number>>; // categoryId → number of slots using it
  usageOf(id: number): Promise<number>;
  create(c: Omit<TimeCategory, 'id' | 'sort'>): Promise<number>;
  update(id: number, patch: Partial<Omit<TimeCategory, 'id'>>): Promise<boolean>;
  delete(id: number): Promise<boolean>;
}

export interface CourseCategoryRepository {
  list(): Promise<CourseCategory[]>;
  usageOf(id: number): Promise<number>; // courses + packs using it
  create(c: Omit<CourseCategory, 'id' | 'sort'>): Promise<number>;
  update(id: number, patch: Partial<Omit<CourseCategory, 'id'>>): Promise<boolean>;
  delete(id: number): Promise<boolean>;
}

export type NewPack = Omit<Pack, 'id' | 'createdAt'>;

export interface PackRepository {
  list(): Promise<Pack[]>;
  findById(id: number): Promise<Pack | null>;
  create(p: NewPack): Promise<number>;
  update(id: number, patch: Partial<Omit<NewPack, 'createdBy'>>): Promise<boolean>;
  /** Courses in a deleted pack become single courses. */
  delete(id: number): Promise<boolean>;
  nextOrder(packId: number): Promise<number>;
}

export interface CourseWrite {
  draft: CourseDraft;
  packId: number | null;
  orderInPack: number | null;
  status: CourseStatus;
}

export interface CourseRepository {
  listSummaries(): Promise<CourseSummary[]>;
  findById(id: number): Promise<Course | null>;
  lessons(courseId: number): Promise<Lesson[]>;
  exercises(courseId: number): Promise<Exercise[]>;
  findLesson(lessonId: number): Promise<Lesson | null>;
  findExercise(exerciseId: number): Promise<(Exercise & { courseId: number }) | null>;
  /** Course, lessons and exercises in one atomic write. */
  create(w: CourseWrite & { createdBy: number }): Promise<number>;
  /** Replace contents atomically. Lessons/exercises with a known id are updated in place (progress kept); others are added; missing ones removed. */
  replace(id: number, w: CourseWrite): Promise<void>;
  patch(id: number, p: { visibility?: Visibility; status?: CourseStatus; packId?: number | null; orderInPack?: number | null }): Promise<void>;
  delete(id: number): Promise<boolean>;
}

export interface Attempt { exerciseId: number; userId: number; answer: unknown; isCorrect: boolean | null; createdAt: string }

export interface ProgressRepository {
  completedLessonIds(userId: number, courseId?: number): Promise<Set<number>>;
  /** Per course: lessons completed and when the user last did something. */
  byCourse(userId: number): Promise<Map<number, { done: number; lastAt: string }>>;
  setCompleted(userId: number, lessonId: number, at: string | null): Promise<void>;
  addAttempt(a: Attempt): Promise<void>;
  latestAttempts(userId: number, exerciseIds: number[]): Promise<Map<number, Attempt>>;
  /** Latest answer per (user, exercise) for other users. */
  othersLatest(exerciseIds: number[], exceptUserId: number): Promise<Attempt[]>;
}

export interface ScheduleRepository {
  loadWeek(userId: number): Promise<Week>;
  /** Write exactly these cells (null = clear) in one atomic batch. */
  saveCells(userId: number, cells: { weekday: number; hour: number; slot: Slot | null }[]): Promise<void>;
  loadTargets(userId: number): Promise<Record<number, number>>;
  saveTargets(userId: number, targets: Record<number, number>): Promise<void>;
}

export interface PrivacyRepository {
  load(userId: number): Promise<Privacy>;
  save(userId: number, p: Privacy): Promise<void>;
}

export interface OAuthCode {
  codeHash: string; clientId: string; userId: number; redirectUri: string; codeChallenge: string; scope: string; autoPublish: boolean; expiresAt: string;
}
export interface OAuthGrant {
  id: number; clientId: string; userId: number; refreshHash: string; accessTokenId: string | null; scope: string; autoPublish: boolean; refreshExpiresAt: string;
}

export interface OAuthRepository {
  createClient(c: Omit<OAuthClient, 'createdAt'>): Promise<void>;
  findClient(id: string): Promise<OAuthClient | null>;
  saveCode(c: OAuthCode): Promise<void>;
  /** Read and delete in one step: a code works once. */
  takeCode(codeHash: string): Promise<OAuthCode | null>;
  createGrant(g: Omit<OAuthGrant, 'id'>): Promise<number>;
  findGrantByRefresh(refreshHash: string): Promise<OAuthGrant | null>;
  findGrantByAccessToken(tokenId: string): Promise<(OAuthGrant & { clientName: string }) | null>;
  /** New refresh token + access token for an existing grant (old refresh stops working). */
  rotateGrant(id: number, refreshHash: string, accessTokenId: string, refreshExpiresAt: string): Promise<void>;
}

export interface Repositories {
  users: UserRepository;
  tokens: TokenRepository;
  timeCategories: TimeCategoryRepository;
  courseCategories: CourseCategoryRepository;
  packs: PackRepository;
  courses: CourseRepository;
  progress: ProgressRepository;
  oauth: OAuthRepository;
  schedules: ScheduleRepository;
  privacy: PrivacyRepository;
}
