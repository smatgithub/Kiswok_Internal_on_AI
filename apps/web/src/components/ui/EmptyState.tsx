import { LucideIcon } from 'lucide-react';
import { Button } from './Button';

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--hover)] text-[var(--text-secondary)]">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h4 className="text-[16px] font-semibold text-[var(--text)]">{title}</h4>
      <p className="mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-4" variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton h-7" />
          ))}
        </div>
      ))}
    </div>
  );
}
