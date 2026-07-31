import type {
  AuthLoginResult,
  AuthLoginSuccess,
  AuthUser,
} from '@kiswok/shared';
import { getStoredToken } from '@/lib/auth-storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010/api';

async function authRequest<T>(
  path: string,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (init?.auth !== false) {
    const token = getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  let body: {
    success?: boolean;
    message?: string;
    data?: T;
  } = {};
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok || body.success === false) {
    throw new Error(
      typeof body.message === 'string' ? body.message : 'Request failed',
    );
  }

  return (body.data !== undefined ? body.data : body) as T;
}

export const authApi = {
  login: (username: string, password: string) =>
    authRequest<AuthLoginResult>('/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ username, password, encoded: false }),
    }),

  verifyOtp: (empId: string, otp: string) =>
    authRequest<AuthLoginSuccess>('/auth/verify-otp', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ empId, otp }),
    }),

  forgotPassword: (empCode: string, loginId: string) =>
    authRequest<Record<string, unknown>>('/auth/forgot-password', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ empCode, loginId }),
    }).then((data) => data),

  resetPassword: (payload: {
    empId: string;
    loginId: string;
    otp: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok || body.success === false) {
        throw new Error(body.message || 'Reset failed');
      }
      return body as { success: boolean; message: string };
    }),

  me: () => authRequest<AuthUser>('/auth/me'),

  logout: () =>
    authRequest<{ message?: string }>('/auth/logout', {
      method: 'POST',
      auth: false,
    }),
};
