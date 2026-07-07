import type { Tool } from '@floorplan/editor';

/** Tool icons — exact SVG paths from the approved design (Editor.dc.html). */
const ICONS: Record<string, string> = {
  select:
    'M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.44 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z',
  wall: 'M3 5h18v14H3z M3 9.7h18 M3 14.3h18 M12 5v4.7 M7.5 9.7v4.6 M16.5 9.7v4.6 M12 14.3V19',
  room: 'M3 3h18v18H3z M12 3v9 M12 12h9',
  door: 'M4 20h16 M7 20V8 M7 8a12 12 0 0 1 12 12',
  window: 'M3 9v6 M21 9v6 M3 10.2h18 M3 13.8h18',
  stairs: 'M4 20h4v-4h4v-4h4V8h4',
  measure:
    'M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z M7.5 10.5l2 2 M10.5 7.5l2 2 M13.5 4.5l2 2',
  text: 'M4 7V4h16v3 M9 20h6 M12 4v16',
};

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Select — tap a room to edit it, drag empty space to pan',
  wall: 'Wall — click to place points, click the last point again or Esc to finish',
  room: 'Room — drag a rectangle to add a room',
  door: 'Door — click a wall to place, drag with Select to slide',
  window: 'Window — click a wall to place, drag with Select to slide',
  stairs: 'Stairs — drag a rectangle to place a flight',
};

interface PaletteEntry {
  id: string;
  tip: string;
  enabled: boolean;
}

const ENTRIES: PaletteEntry[] = [
  { id: 'select', tip: 'Select (V)', enabled: true },
  { id: 'wall', tip: 'Wall (W)', enabled: true },
  { id: 'room', tip: 'Room (R)', enabled: true },
  { id: 'door', tip: 'Door (D)', enabled: true },
  { id: 'window', tip: 'Window (N)', enabled: true },
  { id: 'stairs', tip: 'Stairs (S)', enabled: true },
];

const EXTRA: PaletteEntry[] = [
  { id: 'measure', tip: 'Measure — coming soon', enabled: false },
  { id: 'text', tip: 'Text label — coming soon', enabled: false },
];

function DesignIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function PaletteButton({
  entry,
  active,
  onPick,
}: {
  entry: PaletteEntry;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      title={entry.tip}
      disabled={!entry.enabled}
      onClick={onPick}
      className={`flex h-10 w-10 items-center justify-center rounded-[9px] transition-colors ${
        active
          ? 'bg-brand text-brand-ink'
          : entry.enabled
            ? 'cursor-pointer text-ink-mid hover:bg-shell'
            : 'cursor-not-allowed text-ink-ghost opacity-50'
      }`}
    >
      <DesignIcon d={ICONS[entry.id]} />
    </button>
  );
}

export function ToolPalette({
  tool,
  onPick,
  className = '',
}: {
  tool: Tool;
  onPick: (tool: Tool) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-[13px] border border-line bg-white p-[5px] shadow-float ${className}`}
    >
      {ENTRIES.map((entry) => (
        <PaletteButton
          key={entry.id}
          entry={entry}
          active={tool === entry.id}
          onPick={() => entry.enabled && onPick(entry.id as Tool)}
        />
      ))}
      <div className="mx-[5px] my-[3px] h-px bg-line" />
      {EXTRA.map((entry) => (
        <PaletteButton key={entry.id} entry={entry} active={false} onPick={() => {}} />
      ))}
    </div>
  );
}
