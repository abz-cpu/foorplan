import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Lock,
  LockOpen,
  PanelsTopLeft,
  RefreshCw,
  RotateCw,
  ScanSearch,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  deleteEntity,
  detectRooms,
  findWall,
  floorFootprint,
  floorGiaM2,
  formatAreaM2,
  formatMmAsM,
  generateDescription,
  normalizeDoc,
  roomAreaM2,
  roomPerimeterM,
  ROOM_TYPES,
  setUnderlay,
  suggestRoomNames,
  SYMBOL_DEFS,
  updateLabel,
  updateOpening,
  updateRoom,
  updateSymbol,
  updateWall,
  wallDirection,
  wallLengthMm,
  type FloorDoc,
  type RoomType,
} from '@floorplan/core';
import { useEditorStore } from '@floorplan/editor';
import { useToast } from '@floorplan/ui';

export interface PanelFloor {
  id: string;
  name: string;
  doc: FloorDoc;
}

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

function PanelButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white text-xs font-semibold text-ink-mid hover:bg-shell"
    >
      {icon}
      {label}
    </button>
  );
}

const numberInputClass =
  'h-9 w-full rounded-[9px] border border-input bg-white pl-3 pr-9 font-mono text-[13px] text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]';
const textInputClass =
  'h-9 w-full rounded-[9px] border border-input bg-white px-3 text-[13.5px] font-medium text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]';

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) =>
  e.key === 'Enter' && (e.target as HTMLInputElement).blur();

export function RoomPanel({
  onDownloadCsv,
  address,
  floors,
  initialTab = 'props',
}: {
  onDownloadCsv: () => void;
  address: string;
  floors: PanelFloor[];
  initialTab?: 'props' | 'assistant';
}) {
  const doc = useEditorStore((s) => s.doc);
  const floorId = useEditorStore((s) => s.floorId);
  const selectedId = useEditorStore((s) => s.selectedId);
  const commit = useEditorStore((s) => s.commit);
  const select = useEditorStore((s) => s.select);
  const toast = useToast();

  const [tab, setTab] = useState<'props' | 'assistant'>(initialTab);
  const [aiText, setAiText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const room = doc.rooms.find((r) => r.id === selectedId);
  const wall = doc.walls.find((w) => w.id === selectedId);
  const opening = doc.openings.find((o) => o.id === selectedId);
  const symbol = doc.symbols.find((s) => s.id === selectedId);
  const label = doc.labels.find((l) => l.id === selectedId);
  const openingWall = opening ? findWall(doc, opening.wallId) : undefined;

  const [name, setName] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [wallLen, setWallLen] = useState('');
  const [openingWidth, setOpeningWidth] = useState('');
  const [labelText, setLabelText] = useState('');

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
  useEffect(() => {
    setLabelText(label?.text ?? '');
  }, [label?.id, label?.text, label]);

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
    } else setCeiling(room.ceilingHeightM.toFixed(2));
  };
  const commitWallLength = () => {
    if (!wall) return;
    const v = Number.parseFloat(wallLen);
    const currentM = wallLengthMm(wall) / 1000;
    if (Number.isFinite(v) && v >= 0.1 && v <= 50 && Math.abs(v - currentM) > 0.001) {
      const d = wallDirection(wall);
      commit(
        'Set wall length',
        updateWall(doc, wall.id, { b: { x: wall.a.x + d.x * v * 1000, y: wall.a.y + d.y * v * 1000 } }),
      );
    } else setWallLen(currentM.toFixed(2));
  };
  const commitOpeningWidth = () => {
    if (!opening) return;
    const v = Number.parseFloat(openingWidth);
    if (Number.isFinite(v) && v >= 300 && v <= 5000 && v !== opening.widthMm) {
      commit('Set opening width', updateOpening(doc, opening.id, { widthMm: v }));
    } else setOpeningWidth(String(Math.round(opening.widthMm)));
  };
  const commitLabelText = () => {
    if (label && labelText.trim() && labelText.trim() !== label.text) {
      commit('Edit label', updateLabel(doc, label.id, { text: labelText.trim() }));
    }
  };

  const handleDetectRooms = () => {
    const found = detectRooms(doc);
    if (found.length === 0) {
      toast('No new enclosed rooms found');
      return;
    }
    commit('Detect rooms', { ...doc, rooms: [...doc.rooms, ...found] });
    toast(`${found.length} room${found.length === 1 ? '' : 's'} detected`);
  };

  const handleUnderlayFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      commit(
        'Add underlay',
        setUnderlay(doc, {
          dataUrl: String(reader.result),
          xMm: 0,
          yMm: 0,
          widthMm: 8000,
          opacity: 0.4,
          locked: false,
        }),
      );
      toast('Underlay added — drag it into place, then lock it');
    };
    reader.readAsDataURL(file);
  };

  const assistantFloors = floors.map((f) => ({
    name: f.name,
    doc: f.id === floorId ? doc : normalizeDoc(f.doc),
  }));

  const handleSuggestNames = () => {
    const floorIndex = Math.max(
      floors.findIndex((f) => f.id === floorId),
      0,
    );
    const suggestions = suggestRoomNames(doc, floorIndex);
    if (suggestions.length === 0) {
      toast('Draw some rooms first');
      return;
    }
    let next = doc;
    for (const s of suggestions) next = updateRoom(next, s.roomId, { name: s.name, type: s.type });
    commit('Auto-name rooms', next);
    toast(`${suggestions.length} room${suggestions.length === 1 ? '' : 's'} named`);
  };

  const handleGenerate = () => {
    setAiText(generateDescription({ address, floors: assistantFloors }));
  };

  const footprint = floorFootprint(doc);

  return (
    <aside className="z-[15] flex w-[296px] flex-none flex-col border-l border-line bg-white">
      <div className="flex gap-[3px] border-b border-line-soft px-3 pt-2.5">
        {(
          [
            ['props', 'Properties', <PanelsTopLeft key="i" size={14} />],
            ['assistant', 'Assistant', <Sparkles key="i" size={14} strokeWidth={1.9} />],
          ] as const
        ).map(([id, title, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex cursor-pointer items-center gap-1.5 px-3 pb-2.5 pt-2 text-[13px] font-semibold ${
              tab === id ? 'text-brand shadow-[inset_0_-2px_0_#0B7A5E]' : 'text-ink-faint hover:text-ink-mid'
            }`}
          >
            {icon}
            {title}
          </button>
        ))}
      </div>

      {tab === 'assistant' ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto scroll-momentum px-4 pb-3 pt-4">
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <PanelsTopLeft size={14} className="text-ai" />
              Auto-name rooms
            </div>
            <p className="mb-2.5 mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
              Detect likely room types from size and shape and label every room on this floor.
            </p>
            <button
              type="button"
              onClick={handleSuggestNames}
              className="h-8 cursor-pointer rounded-lg border border-[#DCD0F5] bg-ai-soft px-3 text-[12.5px] font-semibold text-[#5B32B4] hover:bg-[#EDE5FB]"
            >
              Suggest names
            </button>
          </div>

          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <Sparkles size={14} className="text-ai" strokeWidth={1.9} />
              Property description
            </div>
            <p className="mb-2.5 mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
              Draft listing copy from room names, areas and floors — ready for Rightmove or your
              EPC report.
            </p>
            {aiText ? (
              <>
                <div className="mb-2.5 rounded-[9px] border border-line-soft bg-[#F7FAF9] px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-mid">
                  {aiText}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(aiText).catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                    className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-xs font-semibold text-ink-mid hover:bg-shell"
                  >
                    <Copy size={12} />
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-xs font-semibold text-ink-mid hover:bg-shell"
                  >
                    <RefreshCw size={12} />
                    Regenerate
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-ai px-3 text-[12.5px] font-semibold text-white hover:bg-[#5B32B4]"
              >
                <Sparkles size={13} />
                Generate description
              </button>
            )}
          </div>

          <p className="px-0.5 text-[11.5px] leading-relaxed text-ink-ghost">
            Drafts are generated on this device from your plan data only. Claude-powered
            suggestions arrive with cloud sync. Review before publishing.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto scroll-momentum px-4 pb-3 pt-4">
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
                  className={textInputClass}
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
                <div className="mt-3.5">
                  <PanelButton
                    icon={<FlipHorizontal2 size={13} />}
                    label="Flip hinge side"
                    onClick={() =>
                      commit(
                        'Flip door swing',
                        updateOpening(doc, opening.id, {
                          hinge: opening.hinge === 'left' ? 'right' : 'left',
                        }),
                      )
                    }
                  />
                </div>
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
          ) : symbol ? (
            <div>
              <SectionLabel>SELECTED FURNITURE</SectionLabel>
              <div className="mb-3 text-[13.5px] font-semibold">{SYMBOL_DEFS[symbol.kind].name}</div>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Width" value={formatMmAsM(symbol.w)} />
                <StatTile label="Depth" value={formatMmAsM(symbol.h)} />
              </div>
              <div className="mt-3.5">
                <PanelButton
                  icon={<RotateCw size={13} />}
                  label={`Rotate 90° (now ${symbol.rotationDeg}°)`}
                  onClick={() =>
                    commit(
                      'Rotate symbol',
                      updateSymbol(doc, symbol.id, { rotationDeg: (symbol.rotationDeg + 90) % 360 }),
                    )
                  }
                />
              </div>
              <DeleteButton
                label="Delete furniture"
                onClick={() => {
                  commit('Delete symbol', deleteEntity(doc, symbol.id));
                  select(null);
                }}
              />
            </div>
          ) : label ? (
            <div>
              <SectionLabel>SELECTED LABEL</SectionLabel>
              <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Text</label>
              <input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                onBlur={commitLabelText}
                onKeyDown={blurOnEnter}
                className={textInputClass}
              />
              <DeleteButton
                label="Delete label"
                onClick={() => {
                  commit('Delete label', deleteEntity(doc, label.id));
                  select(null);
                }}
              />
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
                Setting a length keeps the first-drawn end fixed. Doors and windows on this wall
                are deleted with it.
              </p>
            </div>
          ) : (
            <>
              <div>
                <SectionLabel>FLOOR SUMMARY</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Gross internal area" value={formatAreaM2(floorGiaM2(doc), 2)} accent />
                  <StatTile label="Footprint area" value={formatAreaM2(footprint.areaM2, 2)} />
                  <StatTile
                    label="Heat-loss perimeter"
                    value={`${footprint.exposedPerimeterM.toFixed(2)} m`}
                    accent
                  />
                  <StatTile label="Rooms" value={String(doc.rooms.length)} />
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <PanelButton
                    icon={<ScanSearch size={13} />}
                    label="Detect rooms from walls"
                    onClick={handleDetectRooms}
                  />
                  <PanelButton
                    icon={<Download size={13} />}
                    label="Download room schedule (CSV)"
                    onClick={onDownloadCsv}
                  />
                </div>
              </div>

              <div>
                <SectionLabel>PHOTO UNDERLAY</SectionLabel>
                {doc.underlay ? (
                  <>
                    <label className="mb-1 block text-xs font-semibold text-ink-mid">
                      Opacity — {Math.round(doc.underlay.opacity * 100)}%
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={Math.round(doc.underlay.opacity * 100)}
                      onChange={(e) =>
                        commit(
                          'Underlay opacity',
                          setUnderlay(doc, { ...doc.underlay!, opacity: Number(e.target.value) / 100 }),
                        )
                      }
                      className="w-full cursor-pointer accent-action"
                    />
                    <div className="mt-2 flex gap-2">
                      <PanelButton
                        icon={doc.underlay.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                        label={doc.underlay.locked ? 'Unlock position' : 'Lock position'}
                        onClick={() =>
                          commit(
                            'Toggle underlay lock',
                            setUnderlay(doc, { ...doc.underlay!, locked: !doc.underlay!.locked }),
                          )
                        }
                      />
                      <button
                        type="button"
                        title="Remove underlay"
                        onClick={() => commit('Remove underlay', setUnderlay(doc, null))}
                        className="flex h-8 w-10 flex-none cursor-pointer items-center justify-center rounded-lg border border-[#F0D9D6] bg-[#FBF0EF] text-danger hover:bg-[#F7E3E1]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-ghost">
                      Drag the photo with Select to position it, then trace walls over it.
                    </p>
                  </>
                ) : (
                  <>
                    <PanelButton
                      icon={<ImagePlus size={13} />}
                      label="Add photo to trace over"
                      onClick={() => fileRef.current?.click()}
                    />
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUnderlayFile(f);
                        e.target.value = '';
                      }}
                    />
                    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-ghost">
                      Photograph a hand sketch or old plan on-site and trace over it.
                    </p>
                  </>
                )}
              </div>

              <p className="px-0.5 text-[11.5px] leading-relaxed text-ink-ghost">
                Heat-loss perimeter is the exposed boundary of all rooms on this floor — shared
                walls between rooms don't count.
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex flex-none items-center justify-between border-t border-line-soft bg-[#F7FAF9] px-4 py-3">
        <span className="text-xs font-semibold text-ink-mid">Gross internal area</span>
        <span className="font-mono text-sm font-medium text-action-soft-ink">
          {formatAreaM2(floorGiaM2(doc))}
        </span>
      </div>
    </aside>
  );
}
