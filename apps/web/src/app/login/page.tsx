import { Suspense } from 'react';
import { LoginPage } from '@/components/auth/LoginPage';

export default function LoginRoute() {
  return (
    <Suspense
      fallback={
        <div className="login-screen">
          <div className="login-screen__panel">
            <p className="text-[var(--text-secondary)]">Loading…</p>
          </div>
        </div>
      }
    >
      <LoginPage />
    </Suspense>
  );
}
