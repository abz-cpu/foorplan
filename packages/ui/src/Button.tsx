import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'soft' | 'outline' | 'ghost';
type Size = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-action text-white shadow-sm hover:bg-action-hover disabled:hover:bg-action',
  soft: 'bg-action-soft text-action-soft-ink hover:bg-action-soft-hover disabled:hover:bg-action-soft',
  outline: 'border border-line bg-white text-ink-mid hover:bg-shell disabled:hover:bg-white',
  ghost: 'text-ink-soft hover:bg-shell disabled:hover:bg-transparent',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-[37px] px-4 text-[13.5px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    />
  );
}
