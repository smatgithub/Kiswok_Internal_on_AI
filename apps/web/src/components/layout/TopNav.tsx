'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';

export function TopNav({
  onMenu,
  onCommandPalette,
  theme,
  onToggleTheme,
  breadcrumbs,
}: {
  onMenu: () => void;
  onCommandPalette: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  breadcrumbs: Array<{ label: string; href?: string }>;
}) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const displayName = user?.name || user?.loginId || 'User';

  return (
    <header className="app-shell__topnav flex h-16 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4">
      <Button
        variant="icon"
        size="icon"
        className="lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu className="h-[18px] w-[18px]" />
      </Button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
        {breadcrumbs.map((crumb, i) => (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-[var(--text-muted)]">/</span> : null}
            <span
              className={
                i === breadcrumbs.length - 1
                  ? 'font-semibold text-[var(--text)]'
                  : 'text-[var(--text-secondary)]'
              }
            >
              {crumb.label}
            </span>
          </span>
        ))}
      </nav>

      <button
        type="button"
        onClick={onCommandPalette}
        className="ml-auto flex h-9 min-w-[180px] max-w-md flex-1 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 text-left text-[13px] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search modules, items, batches…</span>
        <kbd className="ml-auto hidden rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-1">
        <Button variant="icon" size="icon" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
        </Button>
        <Button
          variant="icon"
          size="icon"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-[18px] w-[18px]" />
          ) : (
            <Moon className="h-[18px] w-[18px]" />
          )}
        </Button>
        <div className="relative ml-1" ref={menuRef}>
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--border)] px-2.5 text-[13px] hover:bg-[var(--hover)]"
            aria-label="User menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--selected)] text-[var(--primary)]">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="hidden max-w-[140px] truncate font-medium text-[var(--text)] sm:inline">
              {displayName}
            </span>
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
              <div className="border-b border-[var(--border)] px-3 py-2.5">
                <p className="truncate text-[13px] font-semibold text-[var(--text)]">
                  {displayName}
                </p>
                <p className="truncate text-[12px] text-[var(--text-secondary)]">
                  {user?.loginId}
                  {user?.EmpCode ? ` · ${user.EmpCode}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
