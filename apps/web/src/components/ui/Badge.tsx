import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--hover)] text-[var(--text-secondary)]',
  success: 'bg-[var(--success-bg)] text-[var(--success)]',
  warning: 'bg-[var(--warning-bg)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-bg)] text-[var(--danger)]',
  info: 'bg-[var(--info-bg)] text-[var(--info)]',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone = 'neutral',
  label,
}: {
  tone?: Tone;
  label: string;
}) {
  const colors: Record<Tone, string> = {
    neutral: 'bg-[var(--text-muted)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--warning)]',
    danger: 'bg-[var(--danger)]',
    info: 'bg-[var(--info)]',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
      <span className={cn('h-1.5 w-1.5 rounded-full', colors[tone])} />
      {label}
    </span>
  );
}
