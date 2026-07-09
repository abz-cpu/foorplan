import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  dark = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** For placement on a dark background (e.g. the Tweaks panel) — dims the
   *  track instead of always using the light bg-segment chip, which reads
   *  as a mismatched light rectangle floating on a dark panel. */
  dark?: boolean;
}) {
  return (
    <div
      className={`flex gap-[3px] rounded-[10px] p-[3px] ${dark ? 'bg-white/10' : 'bg-segment'} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              active
                ? 'bg-white text-ink shadow-segment'
                : dark
                  ? 'text-white/70 hover:text-white'
                  : 'text-ink-soft hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
