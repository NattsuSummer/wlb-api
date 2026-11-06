// Repository contracts. Use cases depend on these interfaces only; d1/* implements them for Cloudflare D1.
import type { ApiTokenInfo, CourseCategory, TimeCategory } from '../domain/category';
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

export interface Repositories {
  users: UserRepository;
  tokens: TokenRepository;
  timeCategories: TimeCategoryRepository;
  courseCategories: CourseCategoryRepository;
  schedules: ScheduleRepository;
  privacy: PrivacyRepository;
}
