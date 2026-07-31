import { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function KpiCard({
  label,
  value,
  delta,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  icon?: ReactNode;
}) {
  const deltaColor =
    tone === 'success'
      ? 'text-[var(--success)]'
      : tone === 'danger'
        ? 'text-[var(--danger)]'
        : tone === 'warning'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text-secondary)]';

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
          {label}
        </p>
        {icon ? (
          <span className="text-[var(--text-muted)]">{icon}</span>
        ) : null}
      </div>
      <p className="numeric mt-1.5 text-[22px] font-semibold leading-none text-[var(--text)]">
        {value}
      </p>
      {delta ? (
        <p className={cn('mt-1.5 text-[12px] font-medium', deltaColor)}>{delta}</p>
      ) : null}
    </div>
  );
}
