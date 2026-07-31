import { SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  requiredMark?: boolean;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, requiredMark, options, id, ...props }, ref) => (
    <label className="flex flex-col gap-1.5 text-[13px]">
      {label ? (
        <span className="font-medium text-[var(--text)]">
          {label}
          {requiredMark || props.required ? (
            <span className="ml-0.5 text-[var(--danger)]">*</span>
          ) : null}
        </span>
      ) : null}
      <select
        ref={ref}
        id={id || props.name}
        className={cn(
          'h-9 w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 text-[14px] text-[var(--text)]',
          'focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]',
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
);
Select.displayName = 'Select';
