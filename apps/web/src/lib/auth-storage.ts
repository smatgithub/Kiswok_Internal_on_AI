import type {
  AuthLoginResult,
  AuthLoginSuccess,
  AuthUser,
} from '@kiswok/shared';

const TOKEN_KEY = 'token';
const USER_KEY = 'userInfo';
const AUTH_FLAG = 'kiswok_auth';

export type { AuthUser, AuthLoginResult, AuthLoginSuccess };

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function persistSession(accessToken: string, user: AuthUser) {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Soft gate for Next middleware (same-origin cookie, mirrors V2 session presence)
  document.cookie = `${AUTH_FLAG}=1; path=/; SameSite=Lax; max-age=${7 * 24 * 60 * 60}`;
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem('authorization');
  document.cookie = `${AUTH_FLAG}=; path=/; Max-Age=0; SameSite=Lax`;
}

export function isAuthenticatedClient(): boolean {
  return Boolean(getStoredToken() && getStoredUser());
}
