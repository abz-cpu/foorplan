import { useState } from 'react';
import { useEditorStore } from '@floorplan/editor';
import {
  addRoom,
  addWall,
  DEFAULT_CEILING_HEIGHT_M,
  docBounds,
  newId,
  parseLengthToMm,
  wallsForRoom,
  type RoomRect,
} from '@floorplan/core';

/**
 * Floating "Draw room" panel — the entry point for the two drawing workflows,
 * replacing the old Wall/Room buttons in the side tool palette.
 *
 *  · QuickDraw    — drag a rectangle on the canvas (or type an exact W×D here)
 *  · Wall-by-Wall — click points to trace walls; after the first click, press
 *                   an arrow key + a length + Enter for exact-length walls.
 *
 * The mode buttons just activate the existing 'room' / 'wall' tools; the typed
 * W×D field places a room directly (addRoom + wallsForRoom), never touching the
 * removed auto-thickness path — new walls take the default thickness.
 */
function modeButtonClass(active: boolean): string {
  return `flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-[9px] border px-2.5 py-2 text-[11px] font-semibold transition-colors ${
    active
      ? 'border-brand bg-brand text-brand-ink'
      : 'border-line text-ink-mid hover:border-brand hover:bg-shell'
  }`;
}

export function DrawPanel({ className = '' }: { className?: string }) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const doc = useEditorStore((s) => s.doc);
  const commit = useEditorStore((s) => s.commit);
  const select = useEditorStore((s) => s.select);
  const fitToView = useEditorStore((s) => s.fitToView);

  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const wMm = parseLengthToMm(w);
  const hMm = parseLengthToMm(h);
  const valid = wMm !== null && hMm !== null && wMm >= 100 && hMm >= 100;

  const placeTyped = () => {
    if (wMm === null || hMm === null || wMm < 100 || hMm < 100) return;
    const bounds = docBounds(doc);
    // Drop the room clear of any existing content (never overlapping), then
    // fit the view so the freshly added room is on screen.
    const x = bounds ? bounds.maxX + 500 : 0;
    const y = bounds ? bounds.minY : 0;
    const room: RoomRect = {
      id: newId(),
      x,
      y,
      w: wMm,
      h: hMm,
      name: `Room ${doc.rooms.length + 1}`,
      type: 'Other',
      ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
      includeInGia: true,
    };
    let next = addRoom(doc, room);
    for (const wall of wallsForRoom(doc, room)) next = addWall(next, wall);
    commit('Add room', next);
    select(room.id);
    setW('');
    setH('');
    fitToView();
  };

  const inputClass =
    'h-8 w-14 rounded-md border border-input bg-white px-2 text-center text-[12px] text-ink outline-none focus:border-brand';

  return (
    <div className={`w-[190px] rounded-[13px] border border-line bg-white p-2 shadow-float ${className}`}>
      <div className="px-1 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-ink-ghost">DRAW ROOM</div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setTool('room')}
          title="QuickDraw — drag a rectangle room (R)"
          className={modeButtonClass(tool === 'room')}
        >
          <svg width="24" height="18" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2" y="2" width="20" height="14" rx="1" />
            <line x1="2" y1="2" x2="22" y2="16" strokeDasharray="3 2" strokeWidth="1" opacity="0.5" />
          </svg>
          QuickDraw
        </button>
        <button
          type="button"
          onClick={() => setTool('wall')}
          title="Wall-by-Wall — click points to draw walls (W)"
          className={modeButtonClass(tool === 'wall')}
        >
          <svg width="24" height="18" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="1.6">
            <polyline points="3,15 3,3 12,3 12,10 21,10" />
            <circle cx="3" cy="15" r="1.6" fill="currentColor" />
            <circle cx="3" cy="3" r="1.6" fill="currentColor" />
            <circle cx="12" cy="3" r="1.6" fill="currentColor" />
            <circle cx="12" cy="10" r="1.6" fill="currentColor" />
            <circle cx="21" cy="10" r="1.6" fill="currentColor" />
          </svg>
          Wall-by-Wall
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={w}
          onChange={(e) => setW(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && placeTyped()}
          placeholder="W"
          inputMode="decimal"
          aria-label="Room width"
          className={inputClass}
        />
        <span className="text-[12px] text-ink-ghost">×</span>
        <input
          value={h}
          onChange={(e) => setH(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && placeTyped()}
          placeholder="D"
          inputMode="decimal"
          aria-label="Room depth"
          className={inputClass}
        />
        <button
          type="button"
          disabled={!valid}
          onClick={placeTyped}
          className="h-8 flex-1 cursor-pointer rounded-md bg-action text-[12px] font-semibold text-white hover:bg-action-hover disabled:cursor-default disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="mt-1 px-1 text-[10px] leading-snug text-ink-ghost">
        QuickDraw a room by size (e.g. 4.2 × 3.6), or pick a mode and draw on the canvas.
      </div>
    </div>
  );
}
