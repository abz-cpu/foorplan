import type { PropertyStatus } from '@floorplan/core';
import { statusPills } from './tokens';

export function StatusPill({ status, small }: { status: PropertyStatus; small?: boolean }) {
  const c = statusPills[status];
  return (
    <span
      className={`inline-flex w-fit flex-none items-center gap-1.5 rounded-full font-semibold ${
        small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-[3px] text-[11.5px]'
      }`}
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}
