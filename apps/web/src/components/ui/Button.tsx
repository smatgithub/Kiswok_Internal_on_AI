import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] border border-transparent',
  secondary:
    'bg-[var(--card)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--hover)]',
  ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)] border border-transparent',
  danger:
    'bg-[var(--danger-bg)] text-[var(--danger)] border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] hover:bg-[#fee2e2]',
  icon: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)] border border-transparent',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-[14px] gap-2',
  icon: 'h-9 w-9 p-0 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'md',
      loading,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-[10px] font-medium transition-all duration-150 ease-in-out',
        'disabled:opacity-45 disabled:pointer-events-none',
        'active:scale-[0.98]',
        variants[variant],
        sizes[variant === 'icon' ? 'icon' : size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
