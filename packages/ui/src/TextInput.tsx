import type { InputHTMLAttributes } from 'react';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-9 w-full rounded-[9px] border border-input bg-white px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-ghost focus:border-action focus:ring-[3px] focus:ring-action/[0.13] ${className}`}
      {...rest}
    />
  );
}
