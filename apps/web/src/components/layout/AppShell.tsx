'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { CommandPalette } from './CommandPalette';
import { useAuth } from '@/lib/auth-context';

function crumbsFor(pathname: string) {
  if (pathname.startsWith('/master-data-tracking')) {
    return [
      { label: 'Operations' },
      { label: 'Master Data' },
      { label: 'Tracking' },
    ];
  }
  if (pathname.startsWith('/icsoft-items')) {
    return [
      { label: 'Operations' },
      { label: 'Inventory' },
      { label: 'IcSoft Items' },
    ];
  }
  if (pathname.startsWith('/sap-items')) {
    return [
      { label: 'Operations' },
      { label: 'Inventory' },
      { label: 'SAP Item Creation' },
    ];
  }
  return [{ label: 'Operations' }, { label: 'Dashboard' }];
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status } = useAuth();
  const isLogin = pathname === '/login' || pathname.startsWith('/login/');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem('kiswok-theme') as 'light' | 'dark' | null;
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('kiswok-theme', theme);
  }, [theme]);

  useEffect(() => {
    const open = () => setCommandOpen(true);
    document.addEventListener('kiswok:open-command', open);
    return () => document.removeEventListener('kiswok:open-command', open);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const breadcrumbs = useMemo(() => crumbsFor(pathname), [pathname]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text-secondary)]">
        Restoring session…
      </div>
    );
  }

  if (status === 'anonymous') {
    return null;
  }

  return (
    <>
      <div
        className="app-shell"
        data-sidebar={collapsed ? 'collapsed' : 'expanded'}
        data-mobile-nav={mobileOpen ? 'open' : 'closed'}
      >
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
        />
        <TopNav
          onMenu={() => setMobileOpen(true)}
          onCommandPalette={() => setCommandOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          breadcrumbs={breadcrumbs}
        />
        <main className="app-shell__main">{children}</main>
      </div>
      {mobileOpen ? (
        <div
          className="app-shell__backdrop app-shell__backdrop--visible"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  );
}
