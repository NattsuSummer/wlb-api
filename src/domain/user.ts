// User entities and the shapes we expose for them.

export type Role = 'admin' | 'member';
export type Locale = 'th' | 'en';
export type Theme = 'dark' | 'light' | 'system';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  locale: Locale;
  theme: Theme;
  avatarColor: string | null;
  mustChangePassword: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** User plus the fields only the auth flow needs. */
export interface UserCredentials {
  id: number;
  passwordHash: string;
  disabled: boolean;
  failedLogins: number;
  lockedUntil: string | null;
}

/** The person making a request (resolved from a session or API token). */
export interface Actor {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  tokenId: string;
  tokenKind: 'session' | 'api';
}

export const isAdmin = (a: Pick<Actor, 'role'>) => a.role === 'admin';

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  avatarColor: u.avatarColor,
});

export const selfUser = (u: User) => ({
  ...publicUser(u),
  locale: u.locale,
  theme: u.theme,
  mustChangePassword: u.mustChangePassword,
});

export const adminUser = (u: User) => ({
  ...publicUser(u),
  disabled: u.disabled,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

export const USERNAME_RE = /^[a-z0-9_.-]+$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
