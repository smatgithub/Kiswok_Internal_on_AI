import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  requiredMark?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, requiredMark, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <label className="flex flex-col gap-1.5 text-[13px]">
        {label ? (
          <span className="font-medium text-[var(--text)]">
            {label}
            {requiredMark || props.required ? (
              <span className="ml-0.5 text-[var(--danger)]" aria-hidden>
                *
              </span>
            ) : null}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-9 w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 text-[14px] text-[var(--text)]',
            'placeholder:text-[var(--text-muted)]',
            'hover:border-[var(--border-strong)]',
            'focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]',
            'disabled:bg-[var(--hover)] disabled:text-[var(--text-muted)]',
            error && 'border-[var(--danger)] focus:ring-[color-mix(in_srgb,var(--danger)_35%,white)]',
            className,
          )}
          aria-invalid={Boolean(error)}
          {...props}
        />
        {error ? (
          <span className="text-[12px] text-[var(--danger)]">{error}</span>
        ) : hint ? (
          <span className="text-[12px] text-[var(--text-muted)]">{hint}</span>
        ) : null}
      </label>
    );
  },
);
Input.displayName = 'Input';
