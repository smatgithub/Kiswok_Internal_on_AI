'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  PackagePlus,
  Settings2,
  Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/', label: 'Operations', icon: LayoutDashboard },
  { href: '/icsoft-items', label: 'IcSoft Items', icon: Warehouse },
  { href: '/sap-items', label: 'SAP Item Creation', icon: PackagePlus },
  { href: '/masters', label: 'Masters', icon: Boxes, disabled: true },
  { href: '/settings', label: 'Settings', icon: Settings2, disabled: true },
];

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'app-shell__sidebar flex flex-col border-r border-[var(--border)] bg-[var(--card)]',
        mobileOpen && 'shadow-xl',
      )}
      aria-label="Primary"
    >
      <div className="flex h-16 items-center gap-2 border-b border-[var(--border)] px-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary)] text-white">
          <span className="text-[13px] font-bold tracking-tight">KI</span>
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-[var(--text)]">Kiswok Internal</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">Portal V3 · Enterprise</p>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {NAV.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          const content = (
            <span
              className={cn(
                'flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13px] font-medium transition-colors duration-150',
                active
                  ? 'bg-[var(--selected)] text-[var(--primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)]',
                item.disabled && 'opacity-40 pointer-events-none',
                collapsed && 'justify-center px-0',
              )}
              title={item.label}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </span>
          );

          if (item.disabled) {
            return (
              <div key={item.href} aria-disabled>
                {content}
              </div>
            );
          }

          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover)]"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}
