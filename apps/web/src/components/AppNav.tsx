import { Plus, CloudOff } from 'lucide-react';
import { BrandMark, Button } from '@floorplan/ui';

export function AppNav({ onNewProperty }: { onNewProperty: () => void }) {
  return (
    <nav className="sticky top-0 z-30 flex h-[60px] items-center border-b border-line bg-white px-6">
      <div className="flex items-center gap-2.5">
        <BrandMark size={32} />
        <div className="flex flex-col leading-[1.15]">
          <span className="text-[14.5px] font-bold tracking-tight">L&amp;D Energy</span>
          <span className="text-[10.5px] font-medium tracking-wide text-ink-faint">
            FLOOR PLAN STUDIO
          </span>
        </div>
      </div>

      <div className="ml-9 flex items-center gap-1">
        <span className="rounded-lg bg-action-soft px-3 py-[7px] text-[13.5px] font-semibold text-brand">
          Properties
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-[7px] text-[13.5px] font-medium text-ink-ghost"
          title="Coming soon"
        >
          Templates
        </span>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-[7px] text-[13.5px] font-medium text-ink-ghost"
          title="Coming soon"
        >
          Reports
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <Button onClick={onNewProperty} className="shadow-cta">
          <Plus size={15} strokeWidth={2.4} />
          New Property
        </Button>
        <div className="h-6 w-px bg-line" />
        <span
          className="flex items-center gap-2 rounded-full border border-line bg-shell px-3 py-1.5 text-xs font-semibold text-ink-soft"
          title="Plans are stored on this device. Cloud sync arrives with accounts."
        >
          <CloudOff size={13} />
          Working locally
        </span>
      </div>
    </nav>
  );
}
