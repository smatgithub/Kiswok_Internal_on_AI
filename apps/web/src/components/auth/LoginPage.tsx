'use client';

import { FormEvent, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { isMfaChallenge } from '@kiswok/shared';
import { useAuth } from '@/lib/auth-context';
import { authApi } from '@/lib/auth-api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Mode = 'login' | 'mfa' | 'forgot' | 'reset';

export function LoginPage() {
  const { login, verifyOtp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/';

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [mfaUserId, setMfaUserId] = useState('');
  const [mfaHint, setMfaHint] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [resetEmpId, setResetEmpId] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === 'mfa') return 'Verify identity';
    if (mode === 'forgot') return 'Recover access';
    if (mode === 'reset') return 'Set new password';
    return 'Sign in';
  }, [mode]);

  const subtitle = useMemo(() => {
    if (mode === 'mfa') {
      return mfaHint || 'Enter the OTP sent to your registered email or phone.';
    }
    if (mode === 'forgot') {
      return 'We will send an OTP using your employee code and login ID.';
    }
    if (mode === 'reset') {
      return 'Enter the OTP and choose a new password.';
    }
    return 'Use the same credentials as Kiswok Internal V2.';
  }, [mode, mfaHint]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = await login(username.trim(), password);
      if (isMfaChallenge(data)) {
        setMfaUserId(data.userId);
        const channels = [data.email, data.phone].filter(Boolean).join(' / ');
        setMfaHint(
          channels
            ? `OTP sent to ${channels}`
            : 'OTP sent to your registered contact methods.',
        );
        setMode('mfa');
        setInfo('Multi-factor authentication required.');
        return;
      }
      router.replace(nextPath.startsWith('/') ? nextPath : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(mfaUserId, otp.trim());
      router.replace(nextPath.startsWith('/') ? nextPath : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = (await authApi.forgotPassword(
        empCode.trim(),
        username.trim(),
      )) as { empId?: string | number };
      if (data?.empId != null) setResetEmpId(String(data.empId));
      setInfo('OTP sent. Continue to reset your password.');
      setMode('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.resetPassword({
        empId: resetEmpId,
        loginId: username.trim(),
        otp: resetOtp.trim(),
        newPassword,
        confirmPassword,
      });
      setInfo(result.message || 'Password reset. Please sign in.');
      setMode('login');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setResetOtp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-screen__ambient" aria-hidden />
      <div className="login-screen__panel">
        <header className="login-screen__brand">
          <Image
            src="/kiswok-logo.png"
            alt="Kiswok Industries"
            width={168}
            height={48}
            priority
            className="login-screen__logo"
          />
          <p className="login-screen__product">Internal Portal V3</p>
        </header>

        <div className="login-screen__copy">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>

        {error ? (
          <div className="login-screen__alert login-screen__alert--error" role="alert">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="login-screen__alert login-screen__alert--info" role="status">
            {info}
          </div>
        ) : null}

        {mode === 'login' ? (
          <form className="login-screen__form" onSubmit={onLogin}>
            <Input
              label="Username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Login ID"
            />
            <div className="relative">
              <Input
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="pr-11"
              />
              <button
                type="button"
                className="login-screen__eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <Button type="submit" variant="primary" loading={loading} className="w-full h-11">
              <UserRound className="h-4 w-4" />
              Sign in
            </Button>
            <button
              type="button"
              className="login-screen__link"
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode('forgot');
              }}
            >
              Forgot password?
            </button>
          </form>
        ) : null}

        {mode === 'mfa' ? (
          <form className="login-screen__form" onSubmit={onVerifyOtp}>
            <Input
              label="One-time password"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              placeholder="Enter OTP"
            />
            <Button type="submit" variant="primary" loading={loading} className="w-full h-11">
              <ShieldCheck className="h-4 w-4" />
              Verify & continue
            </Button>
            <button
              type="button"
              className="login-screen__link"
              onClick={() => {
                setMode('login');
                setOtp('');
                setError(null);
                setInfo(null);
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : null}

        {mode === 'forgot' ? (
          <form className="login-screen__form" onSubmit={onForgot}>
            <Input
              label="Employee code"
              name="empCode"
              value={empCode}
              onChange={(e) => setEmpCode(e.target.value)}
              required
              placeholder="EmpCode"
            />
            <Input
              label="Login ID"
              name="loginId"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Username"
            />
            <Button type="submit" variant="primary" loading={loading} className="w-full h-11">
              <KeyRound className="h-4 w-4" />
              Send OTP
            </Button>
            <button
              type="button"
              className="login-screen__link"
              onClick={() => setMode('login')}
            >
              Back to sign in
            </button>
          </form>
        ) : null}

        {mode === 'reset' ? (
          <form className="login-screen__form" onSubmit={onReset}>
            <Input
              label="Employee ID"
              name="empId"
              value={resetEmpId}
              onChange={(e) => setResetEmpId(e.target.value)}
              required
            />
            <Input
              label="OTP"
              name="resetOtp"
              value={resetOtp}
              onChange={(e) => setResetOtp(e.target.value)}
              required
            />
            <Input
              label="New password"
              name="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <Input
              label="Confirm password"
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" loading={loading} className="w-full h-11">
              Update password
            </Button>
            <button
              type="button"
              className="login-screen__link"
              onClick={() => setMode('login')}
            >
              Back to sign in
            </button>
          </form>
        ) : null}

        <footer className="login-screen__footer">
          Authenticated against Internal-API · Same identity store as V2
        </footer>
      </div>
    </div>
  );
}
