import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Compass,
  Copy,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Layers,
  ListChecks,
  Lock,
  LockOpen,
  PanelsTopLeft,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  ScanSearch,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  applyAutoWallThickness,
  autoClassifyWallThickness,
  DEFAULT_WALL_THICKNESS_MM,
  deleteEntities,
  deleteEntity,
  detectRooms,
  EXTERNAL_WALL_THICKNESS_MM,
  findRoomOverlaps,
  findWall,
  floorCeilingHeightM,
  floorFootprint,
  floorHasMixedCeilings,
  setFloorCeilingHeight,
  floorGiaM2,
  formatAreaM2,
  formatMmAsM,
  formatMmForInput,
  normalizeDoc,
  parseLengthToMm,
  roomAreaM2,
  roomPerimeterM,
  ROOM_TYPES,
  scaleDoc,
  setNorthAngle,
  SURVEY_SCHEMA,
  surveyCompletion,
  type PropertySurvey,
  setUnderlay,
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
import { generateDescriptionSmart, isAssistantCloudBacked, suggestRoomNamesSmart } from '../../lib/assistant';
import { RoomScheduleModal } from './RoomScheduleModal';

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
  onMouseEnter,
  onMouseLeave,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // 44px touch target on phones/tablets (on-site assessors), trimmed to
      // 32px on desktop so the panel doesn't look oversized.
      className="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white text-[13px] font-semibold text-ink-mid hover:bg-shell md:min-h-0 md:h-8 md:text-xs"
    >
      {icon}
      {label}
    </button>
  );
}

/** Floor for the room W/L steppers — a room can't be dragged smaller than
 *  this on canvas either (MIN_ROOM_MM in the editor constants). */
const MIN_ROOM_MM_UI = 300;

const numberInputClass =
  'h-9 w-full rounded-[9px] border border-input bg-white pl-3 pr-9 font-mono text-[13px] text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]';
const textInputClass =
  'h-9 w-full rounded-[9px] border border-input bg-white px-3 text-[13.5px] font-medium text-ink outline-none focus:border-action focus:ring-[3px] focus:ring-action/[0.13]';

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) =>
  e.key === 'Enter' && (e.target as HTMLInputElement).blur();

/** mm input with − / + stepper buttons — one tap nudges the value by
 *  `step`, or type an exact number. Commits clamped to [min, max]. */
function SizeStepper({
  label,
  value,
  step,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onCommit: (mm: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const commitVal = (v: number) => {
    if (!Number.isFinite(v)) {
      setText(String(Math.round(value)));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(v)));
    setText(String(clamped));
    if (clamped !== Math.round(value)) onCommit(clamped);
  };
  const stepBtn =
    'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-input bg-white text-[15px] font-semibold text-ink-mid hover:bg-shell disabled:cursor-default disabled:opacity-40';
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-ink-faint">{label}</label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={stepBtn}
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => commitVal(value - step)}
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commitVal(Number.parseFloat(text))}
            onKeyDown={blurOnEnter}
            inputMode="numeric"
            className={numberInputClass}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-ghost">mm</span>
        </div>
        <button
          type="button"
          className={stepBtn}
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => commitVal(value + step)}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Property-level RdSAP survey capture, rendered generically from
 *  SURVEY_SCHEMA so a new field only has to be declared in core. */
function SurveySection({
  survey,
  onChange,
}: {
  survey: PropertySurvey;
  onChange: (next: PropertySurvey) => void;
}) {
  const [open, setOpen] = useState(false);
  const { done, total } = surveyCompletion(survey);
  const set = (key: string, value: string) =>
    onChange({ ...survey, [key]: value === '' ? undefined : value });
  const selectClass =
    'h-8 w-full cursor-pointer rounded-[8px] border border-input bg-white px-2 text-[12.5px] text-ink outline-none focus:border-action';
  return (
    <div className="rounded-[10px] border border-line-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-ghost">
          <ClipboardList size={12} strokeWidth={2} /> EPC SURVEY (RDSAP)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              done > 0 ? 'bg-[#E4EEE8] text-[#3D7457]' : 'bg-shell text-ink-faint'
            }`}
          >
            {done}/{total}
          </span>
          <ChevronDown
            size={14}
            className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line-soft px-3 pb-3 pt-2.5">
          {SURVEY_SCHEMA.map((group) => (
            <div key={group.title}>
              <div className="mb-1.5 text-[11px] font-semibold text-ink-mid">{group.title}</div>
              <div className="flex flex-col gap-1.5">
                {group.fields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2">
                    <span className="w-[42%] shrink-0 text-[11.5px] text-ink-faint">{f.label}</span>
                    {f.options ? (
                      <select
                        value={String(survey[f.key] ?? '')}
                        onChange={(e) => set(f.key, e.target.value)}
                        className={selectClass}
                      >
                        <option value="">—</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.kind === 'number' ? (
                      <div className="relative flex-1">
                        <input
                          value={String(survey[f.key] ?? '')}
                          onChange={(e) => set(f.key, e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="numeric"
                          className={`${selectClass} pr-6`}
                        />
                        {f.suffix ? (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-ghost">
                            {f.suffix}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <input
                        value={String(survey[f.key] ?? '')}
                        onChange={(e) => set(f.key, e.target.value)}
                        className={selectClass}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-ink-ghost">
            Captured per property and included in the EPC CSV export. A data-capture aid, not a SAP
            calculation.
          </p>
        </div>
      )}
    </div>
  );
}

export function RoomPanel({
  onDownloadCsv,
  onDownloadEpcCsv,
  address,
  floors,
  survey,
  onSurveyChange,
  initialTab = 'props',
  variant = 'sidebar',
}: {
  onDownloadCsv: () => void;
  onDownloadEpcCsv: () => void;
  address: string;
  floors: PanelFloor[];
  /** Property-level RdSAP survey capture (see SURVEY_SCHEMA), persisted by
   *  the parent — undefined until the property loads. */
  survey?: PropertySurvey;
  onSurveyChange?: (next: PropertySurvey) => void;
  initialTab?: 'props' | 'assistant';
  /** 'sidebar' = fixed-width right column (desktop); 'sheet' = fills the
   *  mobile bottom-sheet wrapper EditorPage puts it in. */
  variant?: 'sidebar' | 'sheet';
}) {
  const doc = useEditorStore((s) => s.doc);
  const floorId = useEditorStore((s) => s.floorId);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const commit = useEditorStore((s) => s.commit);
  const select = useEditorStore((s) => s.select);
  const setDetectPreview = useEditorStore((s) => s.setDetectPreview);
  const autoWallThickness = useEditorStore((s) => s.autoWallThickness);
  const fitToView = useEditorStore((s) => s.fitToView);
  const toast = useToast();

  const [tab, setTab] = useState<'props' | 'assistant'>(initialTab);
  const [aiText, setAiText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [namingBusy, setNamingBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const room = doc.rooms.find((r) => r.id === selectedId);
  const wall = doc.walls.find((w) => w.id === selectedId);
  const opening = doc.openings.find((o) => o.id === selectedId);
  const symbol = doc.symbols.find((s) => s.id === selectedId);
  const label = doc.labels.find((l) => l.id === selectedId);
  const openingWall = opening ? findWall(doc, opening.wallId) : undefined;

  const [name, setName] = useState('');
  const [floorCeiling, setFloorCeiling] = useState('');
  const [wallLen, setWallLen] = useState('');
  const [wallThickness, setWallThickness] = useState('');
  const [labelText, setLabelText] = useState('');
  const [calibrateLen, setCalibrateLen] = useState('');

  // Clear the detect-rooms preview if the panel unmounts mid-hover
  // (e.g. the mobile sheet closes) so the canvas wash never gets stuck on.
  useEffect(() => () => setDetectPreview(false), [setDetectPreview]);

  useEffect(() => {
    setName(room?.name ?? '');
  }, [room?.id, room?.name, room]);
  useEffect(() => {
    setFloorCeiling(floorCeilingHeightM(doc).toFixed(2));
  }, [doc]);
  useEffect(() => {
    setWallLen(wall ? formatMmForInput(wallLengthMm(wall)) : '');
  }, [wall?.id, wall?.a, wall?.b, wall]);
  useEffect(() => {
    setWallThickness(wall ? String(wall.thickness) : '');
  }, [wall?.id, wall?.thickness, wall]);
  useEffect(() => {
    setLabelText(label?.text ?? '');
  }, [label?.id, label?.text, label]);

  const commitName = () => {
    if (room && name.trim() && name.trim() !== room.name) {
      commit('Rename room', updateRoom(doc, room.id, { name: name.trim() }));
    }
  };
  const commitFloorCeiling = () => {
    const v = Number.parseFloat(floorCeiling);
    if (Number.isFinite(v) && v >= 1 && v <= 6 && v !== floorCeilingHeightM(doc)) {
      commit('Set ceiling height', setFloorCeilingHeight(doc, v));
    } else setFloorCeiling(floorCeilingHeightM(doc).toFixed(2));
  };
  const commitWallLength = () => {
    if (!wall) return;
    const currentMm = wallLengthMm(wall);
    const targetMm = parseLengthToMm(wallLen);
    if (targetMm !== null && targetMm >= 100 && targetMm <= 50_000 && Math.abs(targetMm - currentMm) > 1) {
      const d = wallDirection(wall);
      commit(
        'Set wall length',
        updateWall(doc, wall.id, { b: { x: wall.a.x + d.x * targetMm, y: wall.a.y + d.y * targetMm } }),
      );
    } else {
      setWallLen(formatMmForInput(currentMm));
    }
  };
  const commitWallThickness = () => {
    if (!wall) return;
    const v = Number.parseInt(wallThickness, 10);
    if (Number.isFinite(v) && v >= 50 && v <= 500 && v !== wall.thickness) {
      commit('Set wall thickness', updateWall(doc, wall.id, { thickness: v }));
    } else {
      setWallThickness(String(wall.thickness));
    }
  };
  const commitLabelText = () => {
    if (label && labelText.trim() && labelText.trim() !== label.text) {
      commit('Edit label', updateLabel(doc, label.id, { text: labelText.trim() }));
    }
  };
  // Calibrate the whole plan from this wall's real measured length: scale
  // every drawn dimension by target/current so a roughly-sketched plan (or
  // one traced over a photo at unknown scale) snaps to true scale at once.
  const applyCalibration = () => {
    if (!wall) return;
    const currentMm = wallLengthMm(wall);
    const targetMm = parseLengthToMm(calibrateLen);
    setCalibrateLen('');
    if (targetMm === null || targetMm < 100 || currentMm < 1) return;
    const factor = targetMm / currentMm;
    if (Math.abs(factor - 1) < 0.001) return;
    commit('Calibrate plan scale', scaleDoc(doc, factor, wall.a));
    fitToView();
    toast(`Plan scaled ×${factor.toFixed(3)} to match ${(targetMm / 1000).toFixed(2)}m`);
  };

  const handleDetectRooms = async () => {
    const found = detectRooms(doc);
    if (found.length === 0) {
      toast('No new enclosed rooms found');
      return;
    }
    const floorIndex = Math.max(
      floors.findIndex((f) => f.id === floorId),
      0,
    );
    // Name the detected rooms immediately — closed wall loops should arrive
    // as usable rooms, not generic "Room N" placeholders needing a second
    // manual step in the Assistant tab.
    const withNames = { ...doc, rooms: [...doc.rooms, ...found] };
    const suggestions = await suggestRoomNamesSmart(withNames, floorIndex);
    let next = withNames;
    for (const s of suggestions) {
      if (found.some((f) => f.id === s.roomId)) {
        next = updateRoom(next, s.roomId, { name: s.name, type: s.type });
      }
    }
    // Rooms just appeared, so walls become classifiable — boundary walls
    // turn external, partitions internal (custom thicknesses untouched).
    if (autoWallThickness) next = autoClassifyWallThickness(next);
    commit('Detect rooms', next);
    toast(`${found.length} room${found.length === 1 ? '' : 's'} detected and named`);
  };

  const handleAutoWallThickness = () => {
    if (doc.walls.length === 0) {
      toast('Draw some walls first');
      return;
    }
    commit('Auto-set wall thickness', applyAutoWallThickness(doc));
    toast('External walls thickened, internal walls reset');
  };

  const northAngleDeg = doc.northAngleDeg ?? 0;
  const commitNorthAngle = (deg: number) => {
    commit('Rotate north', setNorthAngle(doc, deg));
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
    id: f.id,
    name: f.name,
    doc: f.id === floorId ? doc : normalizeDoc(f.doc),
  }));

  const handleSuggestNames = async () => {
    const floorIndex = Math.max(
      floors.findIndex((f) => f.id === floorId),
      0,
    );
    setNamingBusy(true);
    try {
      const suggestions = await suggestRoomNamesSmart(doc, floorIndex);
      if (suggestions.length === 0) {
        toast('Draw some rooms first');
        return;
      }
      let next = doc;
      for (const s of suggestions) next = updateRoom(next, s.roomId, { name: s.name, type: s.type });
      commit('Auto-name rooms', next);
      toast(`${suggestions.length} room${suggestions.length === 1 ? '' : 's'} named`);
    } finally {
      setNamingBusy(false);
    }
  };

  const handleGenerate = async () => {
    setGenerateBusy(true);
    try {
      setAiText(await generateDescriptionSmart({ address, floors: assistantFloors }));
    } finally {
      setGenerateBusy(false);
    }
  };

  const footprint = floorFootprint(doc);
  const overlaps = findRoomOverlaps(doc);

  return (
    <aside
      className={
        variant === 'sheet'
          ? 'flex min-h-0 flex-1 flex-col bg-white'
          : 'z-[15] flex w-[296px] flex-none flex-col border-l border-line bg-white'
      }
    >
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
              onClick={() => void handleSuggestNames()}
              disabled={namingBusy}
              className="h-8 cursor-pointer rounded-lg border border-[#DCD0F5] bg-ai-soft px-3 text-[12.5px] font-semibold text-[#5B32B4] hover:bg-[#EDE5FB] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {namingBusy ? 'Thinking…' : 'Suggest names'}
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
                    onClick={() => void handleGenerate()}
                    disabled={generateBusy}
                    className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-xs font-semibold text-ink-mid hover:bg-shell disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw size={12} />
                    {generateBusy ? 'Regenerating…' : 'Regenerate'}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generateBusy}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-ai px-3 text-[12.5px] font-semibold text-white hover:bg-[#5B32B4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles size={13} />
                {generateBusy ? 'Generating…' : 'Generate description'}
              </button>
            )}
          </div>

          <p className="px-0.5 text-[11.5px] leading-relaxed text-ink-ghost">
            {isAssistantCloudBacked()
              ? 'Signed in and online, suggestions use Claude for higher-quality drafts and fall back to this device otherwise. Review before publishing.'
              : 'Drafts are generated on this device from your plan data only. Claude-powered suggestions arrive with cloud sync. Review before publishing.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto scroll-momentum px-4 pb-3 pt-4">
          {selectedIds.length > 1 ? (
            <div>
              <SectionLabel>{`${selectedIds.length} ITEMS SELECTED`}</SectionLabel>
              <p className="text-[12.5px] leading-relaxed text-ink-faint">
                Shift-click (or drag a selection box on empty canvas) to add more, or to remove one from
                the selection.
              </p>
              <DeleteButton
                label={`Delete ${selectedIds.length} items`}
                onClick={() => {
                  commit(`Delete ${selectedIds.length} items`, deleteEntities(doc, selectedIds));
                  select(null);
                }}
              />
            </div>
          ) : room && room.type === 'Stairs' ? (
            /* Stairs are a visual ASSET, not a room — no name, room type,
               area, ceiling height, or GIA fields. Just its footprint and
               asset actions, exactly like furniture. */
            <>
              <div>
                <SectionLabel>SELECTED STAIRS</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Width" value={formatMmAsM(room.w)} />
                  <StatTile label="Length" value={formatMmAsM(room.h)} />
                </div>
              </div>
              <PanelButton
                icon={<FlipHorizontal2 size={13} />}
                label="Flip direction"
                onClick={() =>
                  commit(
                    'Flip stairs direction',
                    updateRoom(doc, room.id, {
                      stairDirection: room.stairDirection === 'reversed' ? 'forward' : 'reversed',
                    }),
                  )
                }
              />
              <DeleteButton
                label="Delete stairs"
                onClick={() => {
                  commit('Delete stairs', deleteEntity(doc, room.id));
                  select(null);
                }}
              />
            </>
          ) : room ? (
            <>
              {(() => {
                const others = overlaps
                  .filter((o) => o.a.id === room.id || o.b.id === room.id)
                  .map((o) => (o.a.id === room.id ? o.b : o.a));
                if (others.length === 0) return null;
                return (
                  <div className="rounded-[10px] border border-[#F0DCC0] bg-[#FBF2E4] px-3 py-2 text-[11.5px] leading-relaxed text-[#8A6B3E]">
                    <span className="font-semibold text-[#9A6B25]">Overlaps {others.map((r) => r.name).join(', ')}.</span>{' '}
                    Move or resize this room so they don't share floor area.
                  </div>
                );
              })()}
              <div>
                <SectionLabel>SELECTED ROOM</SectionLabel>
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
                  {/* 'Stairs' is an asset placed with the Stairs tool, not a
                      room type a room can be converted into. */}
                  {ROOM_TYPES.filter((t) => t !== 'Stairs').map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <SectionLabel>DIMENSIONS</SectionLabel>
                {room.polygon ? (
                  <p className="mb-2 text-[11.5px] leading-relaxed text-ink-faint">
                    This is a shaped room — its outline follows the walls around it. Move or edit
                    those walls to change its shape.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <SizeStepper
                      label="Width"
                      value={room.w}
                      step={100}
                      min={MIN_ROOM_MM_UI}
                      max={100000}
                      onCommit={(mm) => commit('Set room width', updateRoom(doc, room.id, { w: mm }))}
                    />
                    <SizeStepper
                      label="Length"
                      value={room.h}
                      step={100}
                      min={MIN_ROOM_MM_UI}
                      max={100000}
                      onCommit={(mm) => commit('Set room length', updateRoom(doc, room.id, { h: mm }))}
                    />
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <StatTile label="Floor area" value={formatAreaM2(roomAreaM2(room), 2)} accent />
                  <StatTile label="Perimeter" value={`${roomPerimeterM(room).toFixed(1)} m`} />
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-ink-ghost">
                  Ceiling height is set for the whole floor — see Floor summary (deselect this room).
                </p>
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

              <DeleteButton
                label="Delete room"
                onClick={() => {
                  commit('Delete room', deleteEntity(doc, room.id));
                  select(null);
                }}
              />
            </>
          ) : opening ? (
            <div>
              <SectionLabel>{opening.kind === 'door' ? 'SELECTED DOOR' : 'SELECTED WINDOW'}</SectionLabel>
              <SizeStepper
                label="Width"
                value={opening.widthMm}
                step={25}
                min={300}
                max={5000}
                onCommit={(mm) => commit('Set opening width', updateOpening(doc, opening.id, { widthMm: mm }))}
              />
              {openingWall && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatTile label="On wall" value={formatMmAsM(wallLengthMm(openingWall))} />
                  <StatTile label="From end" value={formatMmAsM(opening.offsetMm)} />
                </div>
              )}
              {opening.kind === 'door' && (
                <div className="mt-3.5 flex flex-col gap-2">
                  <PanelButton
                    icon={<FlipHorizontal2 size={13} />}
                    label="Flip hinge side"
                    onClick={() =>
                      commit(
                        'Flip door hinge',
                        updateOpening(doc, opening.id, {
                          hinge: opening.hinge === 'left' ? 'right' : 'left',
                        }),
                      )
                    }
                  />
                  <PanelButton
                    icon={<RotateCw size={13} />}
                    label="Flip swing side (into/out of room)"
                    onClick={() =>
                      commit(
                        'Flip door swing side',
                        updateOpening(doc, opening.id, {
                          swingSide: opening.swingSide === 'b' ? 'a' : 'b',
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
              <div className="flex flex-col gap-2.5">
                <SizeStepper
                  label="Width"
                  value={symbol.w}
                  step={50}
                  min={150}
                  max={10000}
                  onCommit={(mm) => commit('Resize furniture', updateSymbol(doc, symbol.id, { w: mm }))}
                />
                <SizeStepper
                  label="Depth"
                  value={symbol.h}
                  step={50}
                  min={150}
                  max={10000}
                  onCommit={(mm) => commit('Resize furniture', updateSymbol(doc, symbol.id, { h: mm }))}
                />
              </div>
              <div className="mt-3.5 flex flex-col gap-2">
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
                <PanelButton
                  icon={<FlipHorizontal2 size={13} />}
                  label={symbol.mirrored ? 'Mirrored — click to unmirror' : 'Mirror'}
                  onClick={() =>
                    commit('Mirror symbol', updateSymbol(doc, symbol.id, { mirrored: !symbol.mirrored }))
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
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>SELECTED WALL</SectionLabel>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    wall.thickness >= 150
                      ? 'bg-[#E4EEE8] text-[#3D7457]'
                      : 'bg-[#EEECE6] text-[#7A6F5C]'
                  }`}
                >
                  {wall.thickness >= 150 ? 'External wall' : 'Internal wall'}
                </span>
              </div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Exact length</label>
              <input
                value={wallLen}
                onChange={(e) => setWallLen(e.target.value)}
                onBlur={commitWallLength}
                onKeyDown={blurOnEnter}
                placeholder={`e.g. ${formatMmForInput(wallLengthMm(wall))}, 420cm, 13'9"`}
                className={textInputClass}
              />
              <p className="mt-1 text-[11px] text-ink-ghost">Accepts m, cm, mm, or feet/inches (13'9")</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatTile label="Length" value={formatMmAsM(wallLengthMm(wall))} />
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-faint">Thickness (mm)</label>
                  <input
                    value={wallThickness}
                    onChange={(e) => setWallThickness(e.target.value)}
                    onBlur={commitWallThickness}
                    onKeyDown={blurOnEnter}
                    inputMode="numeric"
                    className={numberInputClass}
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWallThickness(String(EXTERNAL_WALL_THICKNESS_MM));
                    commit('Set wall thickness', updateWall(doc, wall.id, { thickness: EXTERNAL_WALL_THICKNESS_MM }));
                  }}
                  className="h-7 flex-1 cursor-pointer rounded-md border border-input bg-white text-[11px] font-semibold text-ink-mid hover:bg-shell"
                >
                  Set External ({EXTERNAL_WALL_THICKNESS_MM}mm)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWallThickness(String(DEFAULT_WALL_THICKNESS_MM));
                    commit('Set wall thickness', updateWall(doc, wall.id, { thickness: DEFAULT_WALL_THICKNESS_MM }));
                  }}
                  className="h-7 flex-1 cursor-pointer rounded-md border border-input bg-white text-[11px] font-semibold text-ink-mid hover:bg-shell"
                >
                  Set Internal ({DEFAULT_WALL_THICKNESS_MM}mm)
                </button>
              </div>
              <div className="mt-4 rounded-[10px] border border-line-soft bg-[#F7FAF9] p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-ghost">
                  <Ruler size={12} strokeWidth={2} /> CALIBRATE PLAN SCALE
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                  Measured this wall on site? Enter its real length and the whole plan scales to
                  match — ideal after a rough sketch or tracing a photo.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={calibrateLen}
                    onChange={(e) => setCalibrateLen(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
                    placeholder="Measured length, e.g. 3.6m"
                    className={`${textInputClass} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={applyCalibration}
                    className="h-9 shrink-0 cursor-pointer rounded-[9px] bg-action px-3 text-[12.5px] font-semibold text-white hover:bg-[#0A6B53]"
                  >
                    Scale plan
                  </button>
                </div>
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
                  <StatTile
                    label="Rooms"
                    value={String(doc.rooms.filter((r) => r.type !== 'Stairs').length)}
                  />
                </div>
                {doc.rooms.some((r) => r.type !== 'Stairs') && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12.5px] font-medium text-ink-mid">Ceiling height</div>
                      <div className="text-[11px] text-ink-ghost">
                        Applies to the whole floor{floorHasMixedCeilings(doc) ? ' — mixed, will unify' : ''}
                      </div>
                    </div>
                    <div className="relative w-[92px] shrink-0">
                      <input
                        value={floorCeiling}
                        onChange={(e) => setFloorCeiling(e.target.value)}
                        onBlur={commitFloorCeiling}
                        onKeyDown={blurOnEnter}
                        inputMode="decimal"
                        className={numberInputClass}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-ghost">m</span>
                    </div>
                  </div>
                )}
                {overlaps.length > 0 && (
                  <div className="mt-3 rounded-[10px] border border-[#F0DCC0] bg-[#FBF2E4] p-3">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#9A6B25]">
                      <AlertTriangle size={13} strokeWidth={2.2} />
                      {overlaps.length === 1 ? '2 rooms overlap' : `${overlaps.length} room overlaps`}
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-[#8A6B3E]">
                      GIA now counts the shared floor area once, but overlapping rooms are usually a
                      mistake. Move, resize or delete one of each pair:
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {overlaps.slice(0, 4).map((o) => (
                        <li key={`${o.a.id}-${o.b.id}`}>
                          <button
                            type="button"
                            onClick={() => select(o.a.id)}
                            className="w-full cursor-pointer rounded-md bg-white/60 px-2 py-1 text-left text-[11.5px] font-medium text-[#7A5A2E] hover:bg-white"
                          >
                            {o.a.name} ↔ {o.b.name}
                            <span className="text-[#A98A5C]"> · {o.areaM2.toFixed(1)} m² shared</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2">
                  <PanelButton
                    icon={<ScanSearch size={13} />}
                    label="Detect rooms from walls"
                    onClick={() => {
                      setDetectPreview(false);
                      void handleDetectRooms();
                    }}
                    onMouseEnter={() => setDetectPreview(true)}
                    onMouseLeave={() => setDetectPreview(false)}
                  />
                  <p className="text-[11px] leading-relaxed text-ink-ghost">
                    L-shaped or other non-rectangular rooms: draw the walls around the shape, then
                    detect — it's covered by a few rectangles sharing one name.
                  </p>
                  <PanelButton
                    icon={<ListChecks size={13} />}
                    label="View room schedule"
                    onClick={() => setScheduleOpen(true)}
                  />
                  <PanelButton
                    icon={<Download size={13} />}
                    label="Download room schedule (CSV)"
                    onClick={onDownloadCsv}
                  />
                  <PanelButton
                    icon={<Download size={13} />}
                    label="Export for EPC (CSV)"
                    onClick={onDownloadEpcCsv}
                  />
                  <PanelButton
                    icon={<Layers size={13} />}
                    label="Auto-set wall thickness"
                    onClick={handleAutoWallThickness}
                  />
                </div>
                {onSurveyChange && (
                  <div className="mt-3">
                    <SurveySection survey={survey ?? {}} onChange={onSurveyChange} />
                  </div>
                )}
              </div>

              <div>
                <SectionLabel>PLAN ORIENTATION</SectionLabel>
                <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
                  <Compass
                    size={30}
                    strokeWidth={1.5}
                    className="flex-none text-ink-soft"
                    style={{ transform: `rotate(${northAngleDeg}deg)` }}
                  />
                  <div className="flex-1">
                    <div className="text-[12.5px] font-medium text-ink-mid">North is {northAngleDeg}°</div>
                    <p className="text-[11px] leading-relaxed text-ink-ghost">
                      Rotates the North arrow shown on exported plans.
                    </p>
                  </div>
                  <div className="flex flex-none gap-1">
                    <button
                      type="button"
                      title="Rotate 15° counter-clockwise"
                      onClick={() => commitNorthAngle(northAngleDeg - 15)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-shell"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      type="button"
                      title="Rotate 15° clockwise"
                      onClick={() => commitNorthAngle(northAngleDeg + 15)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-shell"
                    >
                      <RotateCw size={13} />
                    </button>
                  </div>
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

      {scheduleOpen && (
        <RoomScheduleModal
          address={address}
          floors={assistantFloors}
          onClose={() => setScheduleOpen(false)}
          onDownloadCsv={onDownloadCsv}
        />
      )}
    </aside>
  );
}
