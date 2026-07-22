import { useState } from 'react';
import { Armchair } from 'lucide-react';
import { SYMBOL_DEFS, SYMBOL_KINDS, type SymbolKind } from '@floorplan/core';
import type { Tool } from '@floorplan/editor';

/** Tool icons — exact SVG paths from the approved design (Editor.dc.html). */
const ICONS: Record<string, string> = {
  select:
    'M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.44 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z',
  // Lucide "hand" outline — pan/grab the canvas.
  pan: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2 M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2 M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
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
  select: 'Select — tap anything to edit it, drag empty space to box-select, hold Space to pan',
  pan: 'Pan — drag anywhere to move around the canvas',
  wall: 'Wall-by-Wall — click to place points; after the first click press an arrow key, type a length and Enter for an exact wall; hold Shift for straight',
  room: 'QuickDraw — drag a rectangle (it fits around existing rooms), or click corners for any L/T/U shape (Enter to finish)',
  door: 'Door — click a wall to place, drag with Select to slide',
  window: 'Window — click a wall to place, drag with Select to slide',
  stairs: 'Stairs — drag a rectangle to place a flight',
  symbol: 'Furniture — click to place, drag with Select to move',
  measure: 'Measure — click two points, Esc to clear',
  text: 'Text — click to place a label, edit it in the panel',
};

interface PaletteEntry {
  id: Tool;
  tip: string;
}

const ENTRIES: PaletteEntry[] = [
  { id: 'select', tip: 'Select (V)' },
  { id: 'pan', tip: 'Pan (H) — drag to move the view' },
  { id: 'door', tip: 'Door (D)' },
  { id: 'window', tip: 'Window (N)' },
  { id: 'stairs', tip: 'Stairs (S)' },
];

const EXTRA: PaletteEntry[] = [
  { id: 'measure', tip: 'Measure (M)' },
  { id: 'text', tip: 'Text label (T)' },
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

/** Mini preview of a symbol's primitives for the picker grid. */
function SymbolPreview({ kind }: { kind: SymbolKind }) {
  const def = SYMBOL_DEFS[kind];
  const landscape = def.w >= def.h;
  const vw = landscape ? 100 : (def.w / def.h) * 100;
  const vh = landscape ? (def.h / def.w) * 100 : 100;
  return (
    <svg viewBox={`-6 -6 112 112`} className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={5}>
      <g transform={`translate(${(100 - vw) / 2} ${(100 - vh) / 2}) scale(${vw / 100} ${vh / 100})`}>
        {def.prims.map((p, i) => {
          if (p.t === 'line') return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />;
          if (p.t === 'rect') return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} />;
          return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />;
        })}
      </g>
    </svg>
  );
}

function paletteButtonClass(active: boolean): string {
  // 44px touch target on phones/tablets, trimmed to 40px on desktop.
  return `flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-[9px] transition-colors md:h-10 md:w-10 ${
    active ? 'bg-brand text-brand-ink' : 'text-ink-mid hover:bg-shell'
  }`;
}

export function ToolPalette({
  tool,
  symbolKind,
  onPick,
  onPickSymbol,
  className = '',
  horizontal = false,
}: {
  tool: Tool;
  symbolKind: SymbolKind;
  onPick: (tool: Tool) => void;
  onPickSymbol: (kind: SymbolKind) => void;
  className?: string;
  /** Bottom-of-screen scrollable strip for phones instead of the floating
   *  vertical palette; the furniture popover opens upward. */
  horizontal?: boolean;
}) {
  const [symbolsOpen, setSymbolsOpen] = useState(false);

  return (
    // NOTE: `className` carries the page's `absolute …` placement — don't add
    // another position class here or it fights it; the absolute wrapper is
    // already the positioning context the popover needs.
    <div className={className}>
      <div
        className={
          horizontal
            ? 'flex gap-0.5 overflow-x-auto border-t border-line bg-white px-1.5 py-1'
            : 'flex flex-col gap-0.5 rounded-[13px] border border-line bg-white p-[5px] shadow-float'
        }
      >
        {ENTRIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.tip}
            onClick={() => {
              onPick(entry.id);
              setSymbolsOpen(false);
            }}
            className={paletteButtonClass(tool === entry.id)}
          >
            <DesignIcon d={ICONS[entry.id]} />
          </button>
        ))}
        <button
          type="button"
          title={`Furniture (F) — ${SYMBOL_DEFS[symbolKind].name}`}
          onClick={() => setSymbolsOpen((o) => !o)}
          className={paletteButtonClass(tool === 'symbol')}
        >
          <Armchair size={18} strokeWidth={1.9} />
        </button>
        <div className={horizontal ? 'mx-[3px] my-[5px] w-px flex-none bg-line' : 'mx-[5px] my-[3px] h-px bg-line'} />
        {EXTRA.map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.tip}
            onClick={() => {
              onPick(entry.id);
              setSymbolsOpen(false);
            }}
            className={paletteButtonClass(tool === entry.id)}
          >
            <DesignIcon d={ICONS[entry.id]} />
          </button>
        ))}
      </div>

      {symbolsOpen && (
        <div
          className={`absolute z-20 w-[228px] rounded-[13px] border border-line bg-white p-2.5 shadow-float ${
            horizontal ? 'bottom-[calc(100%+8px)] left-2' : 'left-[56px] top-0'
          }`}
        >
          <div className="mb-1.5 px-1 text-[11px] font-semibold tracking-[0.07em] text-ink-ghost">
            FURNITURE & FIXTURES
          </div>
          <div className="grid grid-cols-3 gap-1">
            {SYMBOL_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                title={SYMBOL_DEFS[kind].name}
                onClick={() => {
                  onPickSymbol(kind);
                  setSymbolsOpen(false);
                }}
                className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg p-1.5 text-[9.5px] font-medium ${
                  tool === 'symbol' && symbolKind === kind
                    ? 'bg-action-soft text-action-soft-ink'
                    : 'text-ink-soft hover:bg-shell'
                }`}
              >
                <SymbolPreview kind={kind} />
                <span className="w-full truncate text-center">{SYMBOL_DEFS[kind].name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
