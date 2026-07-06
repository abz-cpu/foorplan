import { useEffect, useState } from 'react';
import { Sparkles, PanelsTopLeft } from 'lucide-react';
import {
  deleteEntity,
  floorGiaM2,
  formatAreaM2,
  formatMmAsM,
  roomAreaM2,
  roomPerimeterM,
  ROOM_TYPES,
  updateRoom,
  wallLengthMm,
  type RoomType,
} from '@floorplan/core';
import { useEditorStore } from '@floorplan/editor';

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[10px] border border-line-soft bg-[#F7FAF9] px-3 py-2.5">
      <div className="text-[11px] font-medium text-ink-faint">{label}</div>
      <div
        className={`mt-1 font-mono text-[15px] font-medium ${accent ? 'text-action-soft-ink' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-2 text-[11px] font-semibold tracking-[0.07em] text-ink-ghost">{children}</div>
  );
}

export function RoomPanel() {
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const commit = useEditorStore((s) => s.commit);
  const select = useEditorStore((s) => s.select);

  const room = doc.rooms.find((r) => r.id === selectedId);
  const wall = doc.walls.find((w) => w.id === selectedId);

  const [name, setName] = useState('');
  const [ceiling, setCeiling] = useState('');
  useEffect(() => {
    setName(room?.name ?? '');
    setCeiling(room ? room.ceilingHeightM.toFixed(2) : '');
  }, [room?.id, room?.name, room?.ceilingHeightM, room]);

  const commitName = () => {
    if (room && name.trim() && name.trim() !== room.name) {
      commit('Rename room', updateRoom(doc, room.id, { name: name.trim() }));
    }
  };

  const commitCeiling = () => {
    if (!room) return;
    const v = Number.parseFloat(ceiling);
    if (Number.isFinite(v) && v >= 1 && v <= 6 && v !== room.ceilingHeightM) {
      commit('Set ceiling height', updateRoom(doc, room.id, { ceilingHeightM: v }));
    } else {
      setCeiling(room.ceilingHeightM.toFixed(2));
    }
  };

  return (
    <aside className="z-[15] flex w-[296px] flex-none flex-col border-l border-line bg-white">
      <div className="flex gap-[3px] border-b border-line-soft px-3 pt-2.5">
        <button
          type="button"
          className="flex cursor-default items-center gap-1.5 px-3 pb-2.5 pt-2 text-[13px] font-semibold text-brand shadow-[inset_0_-2px_0_#0B7A5E]"
        >
          <PanelsTopLeft size={14} />
          Properties
        </button>
        <button
          type="button"
          disabled
          title="AI Assistant — coming soon"
          className="flex cursor-not-allowed items-center gap-1.5 px-3 pb-2.5 pt-2 text-[13px] font-semibold text-ink-ghost opacity-60"
        >
          <Sparkles size={14} strokeWidth={1.9} />
          AI Assistant
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-4 pb-3 pt-4">
        {room ? (
          <>
            <div>
              <SectionLabel>SELECTED ROOM</SectionLabel>
              <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Room name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="h-9 w-full rounded-[9px] border border-input bg-white px-3 text-[13.5px] font-medium text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]"
              />
              <label className="mb-1.5 mt-3 block text-xs font-semibold text-ink-mid">
                Room type
              </label>
              <select
                value={room.type}
                onChange={(e) =>
                  commit('Set room type', updateRoom(doc, room.id, { type: e.target.value as RoomType }))
                }
                className="h-9 w-full cursor-pointer rounded-[9px] border border-input bg-white px-2 text-[13px] text-ink outline-none focus:border-action"
              >
                {ROOM_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <SectionLabel>DIMENSIONS</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Width" value={formatMmAsM(room.w)} />
                <StatTile label="Length" value={formatMmAsM(room.h)} />
                <StatTile label="Floor area" value={formatAreaM2(roomAreaM2(room), 2)} accent />
                <StatTile label="Perimeter" value={`${roomPerimeterM(room).toFixed(1)} m`} />
              </div>
              <label className="mb-1.5 mt-3 block text-xs font-semibold text-ink-mid">
                Ceiling height
              </label>
              <div className="relative">
                <input
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value)}
                  onBlur={commitCeiling}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  inputMode="decimal"
                  className="h-9 w-full rounded-[9px] border border-input bg-white pl-3 pr-9 font-mono text-[13px] text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-ghost">
                  m
                </span>
              </div>
              <label className="mt-3.5 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={room.includeInGia}
                  onChange={(e) =>
                    commit('Toggle GIA', updateRoom(doc, room.id, { includeInGia: e.target.checked }))
                  }
                  className="h-[15px] w-[15px] cursor-pointer accent-action"
                />
                <span className="text-[12.5px] font-medium text-ink-mid">
                  Include in gross internal area
                </span>
              </label>
            </div>
          </>
        ) : wall ? (
          <div>
            <SectionLabel>SELECTED WALL</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Length" value={formatMmAsM(wallLengthMm(wall))} />
              <StatTile label="Thickness" value={`${wall.thickness} mm`} />
            </div>
            <button
              type="button"
              onClick={() => {
                commit('Delete wall', deleteEntity(doc, wall.id));
                select(null);
              }}
              className="mt-4 h-8 w-full cursor-pointer rounded-lg border border-[#F0D9D6] bg-[#FBF0EF] text-xs font-semibold text-danger hover:bg-[#F7E3E1]"
            >
              Delete wall
            </button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-ghost">
              Tip: Backspace also deletes the selected element.
            </p>
          </div>
        ) : (
          <div className="mt-6 px-1 text-center text-[12.5px] leading-relaxed text-ink-ghost">
            Nothing selected.
            <br />
            Tap a room or wall with the Select tool, or draw with{' '}
            <span className="font-semibold text-ink-soft">W</span> (walls) and{' '}
            <span className="font-semibold text-ink-soft">R</span> (rooms).
          </div>
        )}
      </div>

      <div className="flex flex-none items-center justify-between border-t border-line-soft bg-[#F7FAF9] px-4 py-3">
        <span className="text-xs font-semibold text-ink-mid">Gross internal area</span>
        <span className="font-mono text-sm font-medium text-action-soft-ink">
          {formatAreaM2(floorGiaM2(doc))}
        </span>
      </div>
    </aside>
  );
}
