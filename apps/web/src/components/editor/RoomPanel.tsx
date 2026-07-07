import { useEffect, useState } from 'react';
import { Download, FlipHorizontal2, Sparkles, PanelsTopLeft } from 'lucide-react';
import {
  deleteEntity,
  findWall,
  floorFootprint,
  floorGiaM2,
  formatAreaM2,
  formatMmAsM,
  roomAreaM2,
  roomPerimeterM,
  ROOM_TYPES,
  updateOpening,
  updateRoom,
  updateWall,
  wallDirection,
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

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 h-8 w-full cursor-pointer rounded-lg border border-[#F0D9D6] bg-[#FBF0EF] text-xs font-semibold text-danger hover:bg-[#F7E3E1]"
    >
      {label}
    </button>
  );
}

const numberInputClass =
  'h-9 w-full rounded-[9px] border border-input bg-white pl-3 pr-9 font-mono text-[13px] text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]';

export function RoomPanel({ onDownloadCsv }: { onDownloadCsv: () => void }) {
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const commit = useEditorStore((s) => s.commit);
  const select = useEditorStore((s) => s.select);

  const room = doc.rooms.find((r) => r.id === selectedId);
  const wall = doc.walls.find((w) => w.id === selectedId);
  const opening = doc.openings.find((o) => o.id === selectedId);
  const openingWall = opening ? findWall(doc, opening.wallId) : undefined;

  const [name, setName] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [wallLen, setWallLen] = useState('');
  const [openingWidth, setOpeningWidth] = useState('');

  useEffect(() => {
    setName(room?.name ?? '');
    setCeiling(room ? room.ceilingHeightM.toFixed(2) : '');
  }, [room?.id, room?.name, room?.ceilingHeightM, room]);

  useEffect(() => {
    setWallLen(wall ? (wallLengthMm(wall) / 1000).toFixed(2) : '');
  }, [wall?.id, wall?.a, wall?.b, wall]);

  useEffect(() => {
    setOpeningWidth(opening ? String(Math.round(opening.widthMm)) : '');
  }, [opening?.id, opening?.widthMm, opening]);

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

  const commitWallLength = () => {
    if (!wall) return;
    const v = Number.parseFloat(wallLen);
    const currentM = wallLengthMm(wall) / 1000;
    if (Number.isFinite(v) && v >= 0.1 && v <= 50 && Math.abs(v - currentM) > 0.001) {
      const d = wallDirection(wall);
      const b = { x: wall.a.x + d.x * v * 1000, y: wall.a.y + d.y * v * 1000 };
      commit('Set wall length', updateWall(doc, wall.id, { b }));
    } else {
      setWallLen(currentM.toFixed(2));
    }
  };

  const commitOpeningWidth = () => {
    if (!opening) return;
    const v = Number.parseFloat(openingWidth);
    if (Number.isFinite(v) && v >= 300 && v <= 5000 && v !== opening.widthMm) {
      commit('Set opening width', updateOpening(doc, opening.id, { widthMm: v }));
    } else {
      setOpeningWidth(String(Math.round(opening.widthMm)));
    }
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) =>
    e.key === 'Enter' && (e.target as HTMLInputElement).blur();

  const footprint = floorFootprint(doc);

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
              <SectionLabel>{room.type === 'Stairs' ? 'SELECTED STAIRS' : 'SELECTED ROOM'}</SectionLabel>
              <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Room name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={blurOnEnter}
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
                  onKeyDown={blurOnEnter}
                  inputMode="decimal"
                  className={numberInputClass}
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
        ) : opening ? (
          <div>
            <SectionLabel>{opening.kind === 'door' ? 'SELECTED DOOR' : 'SELECTED WINDOW'}</SectionLabel>
            <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Width</label>
            <div className="relative">
              <input
                value={openingWidth}
                onChange={(e) => setOpeningWidth(e.target.value)}
                onBlur={commitOpeningWidth}
                onKeyDown={blurOnEnter}
                inputMode="numeric"
                className={numberInputClass}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-ghost">
                mm
              </span>
            </div>
            {openingWall && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatTile label="On wall" value={formatMmAsM(wallLengthMm(openingWall))} />
                <StatTile label="From end" value={formatMmAsM(opening.offsetMm)} />
              </div>
            )}
            {opening.kind === 'door' && (
              <button
                type="button"
                onClick={() =>
                  commit(
                    'Flip door swing',
                    updateOpening(doc, opening.id, {
                      hinge: opening.hinge === 'left' ? 'right' : 'left',
                    }),
                  )
                }
                className="mt-3.5 flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white text-xs font-semibold text-ink-mid hover:bg-shell"
              >
                <FlipHorizontal2 size={13} />
                Flip hinge side
              </button>
            )}
            <DeleteButton
              label={opening.kind === 'door' ? 'Delete door' : 'Delete window'}
              onClick={() => {
                commit('Delete opening', deleteEntity(doc, opening.id));
                select(null);
              }}
            />
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-ghost">
              Tip: with Select, drag the {opening.kind} to slide it along its wall.
            </p>
          </div>
        ) : wall ? (
          <div>
            <SectionLabel>SELECTED WALL</SectionLabel>
            <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Exact length</label>
            <div className="relative">
              <input
                value={wallLen}
                onChange={(e) => setWallLen(e.target.value)}
                onBlur={commitWallLength}
                onKeyDown={blurOnEnter}
                inputMode="decimal"
                className={numberInputClass}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-ghost">
                m
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatTile label="Length" value={formatMmAsM(wallLengthMm(wall))} />
              <StatTile label="Thickness" value={`${wall.thickness} mm`} />
            </div>
            <DeleteButton
              label="Delete wall"
              onClick={() => {
                commit('Delete wall', deleteEntity(doc, wall.id));
                select(null);
              }}
            />
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-ghost">
              Setting a length keeps the first-drawn end fixed. Doors and windows on this wall are
              deleted with it.
            </p>
          </div>
        ) : (
          <div>
            <SectionLabel>FLOOR SUMMARY</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Gross internal area" value={formatAreaM2(floorGiaM2(doc), 2)} accent />
              <StatTile label="Footprint area" value={formatAreaM2(footprint.areaM2, 2)} />
              <StatTile label="Heat-loss perimeter" value={`${footprint.exposedPerimeterM.toFixed(2)} m`} accent />
              <StatTile label="Rooms" value={String(doc.rooms.length)} />
            </div>
            <button
              type="button"
              onClick={onDownloadCsv}
              className="mt-4 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white text-xs font-semibold text-ink-mid hover:bg-shell"
            >
              <Download size={13} />
              Download room schedule (CSV)
            </button>
            <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-ink-ghost">
              Heat-loss perimeter is the exposed boundary of all rooms on this floor — shared walls
              between rooms don't count. Select a room, wall, door or window to edit it.
            </p>
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
