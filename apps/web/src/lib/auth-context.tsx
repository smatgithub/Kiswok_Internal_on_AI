'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AuthLoginResult,
  AuthUser,
  isMfaChallenge,
} from '@kiswok/shared';
import { authApi } from '@/lib/auth-api';
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  persistSession,
} from '@/lib/auth-storage';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<AuthLoginResult>;
  verifyOtp: (empId: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: (accessToken: string, user: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = getStoredToken();
    const storedUser = getStoredUser();
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(storedUser);
      setStatus('authenticated');
      // Soft revalidate — do not block UI
      authApi
        .me()
        .then((fresh) => setUser(fresh))
        .catch(() => {
          clearSession();
          setToken(null);
          setUser(null);
          setStatus('anonymous');
        });
    } else {
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (status === 'anonymous' && !isPublic) {
      const next = encodeURIComponent(pathname || '/');
      router.replace(`/login?next=${next}`);
    } else if (status === 'authenticated' && pathname === '/login') {
      router.replace('/');
    }
  }, [status, pathname, router]);

  const completeLogin = useCallback((accessToken: string, nextUser: AuthUser) => {
    persistSession(accessToken, nextUser);
    setToken(accessToken);
    setUser(nextUser);
    setStatus('authenticated');
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await authApi.login(username, password);
      if (!isMfaChallenge(data)) {
        completeLogin(data.accessToken, data.user);
      }
      return data;
    },
    [completeLogin],
  );

  const verifyOtp = useCallback(
    async (empId: string, otp: string) => {
      const data = await authApi.verifyOtp(empId, otp);
      completeLogin(data.accessToken, data.user);
    },
    [completeLogin],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore network errors on logout */
    }
    clearSession();
    setToken(null);
    setUser(null);
    setStatus('anonymous');
    router.replace('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      token,
      login,
      verifyOtp,
      logout,
      completeLogin,
    }),
    [status, user, token, login, verifyOtp, logout, completeLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
