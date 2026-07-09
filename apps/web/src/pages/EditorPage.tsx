import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  HardDrive,
  Maximize,
  Minus,
  MousePointerClick,
  PanelsTopLeft,
  Plus,
  Redo2,
  Ruler,
  ScanSearch,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  buildEpcCsv,
  buildRoomScheduleCsv,
  copyPerimeterWalls,
  deleteEntities,
  normalizeDoc,
  type FloorDoc,
  type PropertyStatus,
} from '@floorplan/core';
import type { FloorRecord, PropertyRecord } from '@floorplan/data';
import { BASE_PX_PER_MM, EditorCanvas, useEditorStore, ZOOM_STEP } from '@floorplan/editor';
import { downloadBlob, slugify } from '@floorplan/export';
import { BrandMark, SegmentedControl, StatusPill, Toggle, useToast } from '@floorplan/ui';
import { ExportModal } from '../components/export/ExportModal';
import { RoomPanel } from '../components/editor/RoomPanel';
import { ToolPalette, TOOL_HINTS } from '../components/editor/ToolPalette';
import { repos } from '../lib/repos';
import { useIsMobile } from '../lib/useIsMobile';

const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];
const EDITOR_WELCOME_SEEN_KEY = 'floorplan:seenEditorWelcome';

/** Shown one at a time to new users, capped by a localStorage counter. */
const PRO_TIPS = [
  'Pro tip: press W to draw walls, R for rooms, D for doors',
  'Pro tip: hold Space (or pick the hand tool) and drag to pan',
  'Pro tip: while drawing a wall, press X to flip internal/external',
];

function TopBarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      // 44px touch target on phones/tablets, 38px on desktop (the surrounding
      // bg-shell strip's 4px padding brings even that up to ~46px hit area).
      className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-[8px] text-ink-mid hover:bg-white hover:shadow-segment disabled:cursor-default disabled:text-ink-ghost disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:shadow-none md:h-[38px] md:w-[38px]"
    >
      {children}
    </button>
  );
}

export default function EditorPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [floors, setFloors] = useState<FloorRecord[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(searchParams.get('export') === '1');
  // 2-step confirm, same pattern as property delete on the dashboard —
  // first click arms, second click within 3s executes.
  const [confirmDeleteFloorId, setConfirmDeleteFloorId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem(EDITOR_WELCOME_SEEN_KEY) !== '1',
  );
  const toast = useToast();
  const isMobile = useIsMobile();
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const dismissWelcome = () => {
    localStorage.setItem(EDITOR_WELCOME_SEEN_KEY, '1');
    setShowWelcome(false);
  };

  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const symbolKind = useEditorStore((s) => s.symbolKind);
  const setSymbolKind = useEditorStore((s) => s.setSymbolKind);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const fitToView = useEditorStore((s) => s.fitToView);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const gridStyle = useEditorStore((s) => s.gridStyle);
  const setGridStyle = useEditorStore((s) => s.setGridStyle);
  const showDimensions = useEditorStore((s) => s.showDimensions);
  const toggleShowDimensions = useEditorStore((s) => s.toggleShowDimensions);
  const showRoomLabels = useEditorStore((s) => s.showRoomLabels);
  const toggleShowRoomLabels = useEditorStore((s) => s.toggleShowRoomLabels);
  const showFurniture = useEditorStore((s) => s.showFurniture);
  const toggleShowFurniture = useEditorStore((s) => s.toggleShowFurniture);
  const planMode = useEditorStore((s) => s.planMode);
  const setPlanMode = useEditorStore((s) => s.setPlanMode);
  const saveState = useEditorStore((s) => s.saveState);
  const doc = useEditorStore((s) => s.doc);
  const floorId = useEditorStore((s) => s.floorId);
  const loadFloor = useEditorStore((s) => s.loadFloor);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);

  // On phones the properties panel is a bottom sheet. Slide it up whenever a
  // selection appears (that's the moment its content becomes relevant) —
  // closing is manual, so browsing the floor summary isn't interrupted.
  useEffect(() => {
    if (isMobile && selectedCount > 0) setMobilePanelOpen(true);
  }, [isMobile, selectedCount]);

  /* Keyboard pro-tips: a non-intrusive rotating hint shown a handful of
     times to new users, then never again. Fires ~8s after the editor
     settles so it doesn't collide with the welcome card. */
  useEffect(() => {
    const KEY = 'floorplan:proTipsShown';
    const shown = Number(localStorage.getItem(KEY) ?? '0');
    if (shown >= PRO_TIPS.length) return;
    const tip = PRO_TIPS[shown];
    const t = setTimeout(() => {
      toast(tip);
      localStorage.setItem(KEY, String(shown + 1));
    }, 8000);
    return () => clearTimeout(t);
    // Run once per editor mount; the localStorage counter caps total shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSavedRef = useRef<FloorDoc | null>(null);

  /* Initial load */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!propertyId) return;
      const prop = await repos.properties.get(propertyId);
      if (cancelled) return;
      if (!prop) {
        setNotFound(true);
        return;
      }
      const fls = await repos.floors.listByProperty(propertyId);
      if (cancelled) return;
      setProperty(prop);
      setFloors(fls);
      const first = fls[0];
      if (first) {
        const doc = normalizeDoc(first.doc);
        lastSavedRef.current = doc;
        loadFloor(first.id, doc);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, loadFloor]);

  /* Debounced autosave whenever the document changes */
  useEffect(() => {
    if (!floorId || doc === lastSavedRef.current) return;
    useEditorStore.getState().markSaving();
    const t = setTimeout(async () => {
      await repos.floors.saveDoc(floorId, doc);
      lastSavedRef.current = doc;
      useEditorStore.getState().markSaved();
    }, 700);
    return () => clearTimeout(t);
  }, [doc, floorId]);

  const flushSave = useCallback(async () => {
    const { floorId: fid, doc: d, markSaved } = useEditorStore.getState();
    if (fid && d !== lastSavedRef.current) {
      await repos.floors.saveDoc(fid, d);
      lastSavedRef.current = d;
      markSaved();
    }
  }, []);

  /* Flush pending changes when leaving the editor */
  useEffect(() => {
    return () => {
      void flushSave();
    };
  }, [flushSave]);

  const switchFloor = async (floor: FloorRecord) => {
    if (floor.id === floorId) return;
    await flushSave();
    const fresh = (await repos.floors.get(floor.id)) ?? floor;
    const doc = normalizeDoc(fresh.doc);
    lastSavedRef.current = doc;
    loadFloor(fresh.id, doc);
  };

  const addFloor = async () => {
    if (!propertyId) return;
    await flushSave();
    const name = FLOOR_NAMES[floors.length] ?? `Floor ${floors.length}`;
    const created = await repos.floors.create(propertyId, name, floors.length);
    setFloors((f) => [...f, created]);
    lastSavedRef.current = created.doc;
    loadFloor(created.id, created.doc);
  };

  const addFloorWithPerimeter = async () => {
    if (!propertyId) return;
    await flushSave();
    const name = FLOOR_NAMES[floors.length] ?? `Floor ${floors.length}`;
    const created = await repos.floors.create(propertyId, name, floors.length);
    const perimeterDoc = copyPerimeterWalls(doc);
    await repos.floors.saveDoc(created.id, perimeterDoc);
    setFloors((f) => [...f, { ...created, doc: perimeterDoc }]);
    lastSavedRef.current = perimeterDoc;
    loadFloor(created.id, perimeterDoc);
    toast('Perimeter walls copied to new floor');
  };

  const requestDeleteFloor = (id: string) => {
    if (floors.length <= 1) return;
    if (confirmDeleteFloorId === id) {
      void deleteFloorConfirmed(id);
    } else {
      setConfirmDeleteFloorId(id);
      setTimeout(() => setConfirmDeleteFloorId((prev) => (prev === id ? null : prev)), 3000);
    }
  };

  const deleteFloorConfirmed = async (id: string) => {
    setConfirmDeleteFloorId(null);
    await repos.floors.remove(id);
    const remaining = floors.filter((f) => f.id !== id);
    setFloors(remaining);
    if (id === floorId) {
      const next = remaining[0];
      if (next) {
        const fresh = (await repos.floors.get(next.id)) ?? next;
        const nextDoc = normalizeDoc(fresh.doc);
        lastSavedRef.current = nextDoc;
        loadFloor(fresh.id, nextDoc);
      }
    }
    toast('Floor deleted');
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const store = useEditorStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          store.setTool('select');
          break;
        case 'h':
          store.setTool('pan');
          break;
        case 'w':
          store.setTool('wall');
          break;
        case 'r':
          store.setTool('room');
          break;
        case 'd':
          store.setTool('door');
          break;
        case 'n':
          store.setTool('window');
          break;
        case 's':
          store.setTool('stairs');
          break;
        case 'm':
          store.setTool('measure');
          break;
        case 't':
          store.setTool('text');
          break;
        case 'f':
          store.setTool('symbol');
          break;
        case '+':
        case '=':
          store.zoomBy(ZOOM_STEP);
          break;
        case '-':
          store.zoomBy(1 / ZOOM_STEP);
          break;
        case 'backspace':
        case 'delete':
          if (store.selectedIds.length > 0) {
            e.preventDefault();
            const count = store.selectedIds.length;
            store.commit(
              count > 1 ? `Delete ${count} items` : 'Delete',
              deleteEntities(store.doc, store.selectedIds),
            );
            store.select(null);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setStatus = async (status: PropertyStatus) => {
    if (!property) return;
    await repos.properties.update(property.id, { status });
    setProperty({ ...property, status });
    setStatusMenuOpen(false);
  };

  const downloadCsv = async () => {
    if (!property) return;
    await flushSave();
    const fresh = await repos.floors.listByProperty(property.id);
    const csv = buildRoomScheduleCsv(
      `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}`,
      fresh.map((f) => ({ name: f.name, doc: normalizeDoc(f.doc) })),
    );
    downloadBlob(`${slugify(property.addressLine1)}-room-schedule.csv`, new Blob([csv], { type: 'text/csv' }));
    toast('Room schedule downloaded');
  };

  const downloadEpcCsv = async () => {
    if (!property) return;
    await flushSave();
    const fresh = await repos.floors.listByProperty(property.id);
    const csv = buildEpcCsv(
      `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}`,
      fresh.map((f) => ({ name: f.name, doc: normalizeDoc(f.doc) })),
    );
    downloadBlob(`${slugify(property.addressLine1)}-epc.csv`, new Blob([csv], { type: 'text/csv' }));
    toast('EPC data downloaded');
  };

  const closeExport = () => {
    setExportOpen(false);
    if (searchParams.get('export')) setSearchParams({}, { replace: true });
  };

  const activeFloor = floors.find((f) => f.id === floorId);

  if (notFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <div className="text-[15px] font-semibold text-ink-mid">Property not found</div>
        <Link to="/" className="text-[13px] font-semibold text-action hover:underline">
          Back to My Properties
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <header className="z-20 flex h-[52px] flex-none items-center gap-1.5 border-b border-line bg-white px-2 md:gap-2.5 md:px-3">
        <Link
          to="/"
          title="Back to My Properties"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-ink-mid hover:bg-shell"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
        </Link>
        <span className="hidden sm:block">
          <BrandMark size={26} />
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold tracking-tight">
            {property ? `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}` : '…'}
          </span>
          {property && (
            <div className="relative">
              <button
                type="button"
                title="Change status"
                onClick={() => setStatusMenuOpen((o) => !o)}
                className="flex cursor-pointer items-center gap-1"
              >
                <StatusPill status={property.status} small />
                <ChevronDown size={12} className="text-ink-faint" />
              </button>
              {statusMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStatusMenuOpen(false)} />
                  <div className="absolute left-0 top-7 z-50 w-40 overflow-hidden rounded-xl border border-line bg-white p-1.5 shadow-toast">
                    {(['draft', 'ready'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void setStatus(s)}
                        className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-ink-mid hover:bg-shell"
                      >
                        <StatusPill status={s} small />
                        {property.status === s && <Check size={13} className="text-action" />}
                      </button>
                    ))}
                    <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] leading-snug text-ink-ghost">
                      Exported is set automatically when you export the plan.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 rounded-[9px] bg-shell p-0.5">
          <TopBarButton title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 size={15} />
          </TopBarButton>
          <TopBarButton title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
            <Redo2 size={15} />
          </TopBarButton>
        </div>

        {/* Pinch-zoom covers zooming on touch screens; the button cluster
            only earns its top-bar space on md+. */}
        <div className="hidden items-center gap-0.5 rounded-[9px] bg-shell p-0.5 md:flex">
          <TopBarButton title="Zoom out (−)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus size={15} strokeWidth={2.2} />
          </TopBarButton>
          <span className="min-w-[48px] text-center font-mono text-xs font-medium text-ink-mid">
            {Math.round(zoom * 100)}%
          </span>
          <TopBarButton title="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus size={15} strokeWidth={2.2} />
          </TopBarButton>
          <TopBarButton title="Fit to screen" onClick={fitToView}>
            <Maximize size={14} />
          </TopBarButton>
        </div>

        <div
          className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-ink-soft md:min-w-[155px] md:px-2.5"
          title={saveState === 'saved' ? 'Saved on this device' : 'Saving…'}
        >
          <HardDrive size={15} className={saveState === 'saved' ? 'text-success' : 'text-ink-ghost'} />
          <span className="hidden md:inline">
            {saveState === 'saved' ? 'Saved on this device' : 'Saving…'}
          </span>
        </div>

        <button
          type="button"
          title="Properties & floor summary"
          onClick={() => setMobilePanelOpen((o) => !o)}
          className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-[9px] border border-line bg-white text-ink-mid md:hidden"
        >
          <PanelsTopLeft size={16} />
        </button>

        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="flex h-[35px] flex-none cursor-pointer items-center gap-1.5 rounded-[9px] bg-action px-2.5 text-[13px] font-semibold text-white shadow-cta hover:bg-action-hover md:px-3.5"
        >
          <Download size={14} strokeWidth={2.2} />
          <span className="hidden sm:inline">Export Plan</span>
          <span className="sm:hidden">Export</span>
        </button>
      </header>

      {/* Workspace */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0">
            <EditorCanvas className="h-full w-full" />
          </div>

          <ToolPalette
            tool={tool}
            symbolKind={symbolKind}
            onPick={setTool}
            onPickSymbol={setSymbolKind}
            className="absolute left-3.5 top-1/2 z-10 hidden -translate-y-1/2 md:block"
          />

          {/* Phones get a horizontal, scrollable tool strip along the bottom
              instead — the vertical palette would collide with the floor tabs
              and eat a third of a narrow canvas. */}
          <ToolPalette
            horizontal
            tool={tool}
            symbolKind={symbolKind}
            onPick={setTool}
            onPickSymbol={setSymbolKind}
            className="absolute inset-x-0 bottom-0 z-10 pb-[env(safe-area-inset-bottom)] md:hidden"
          />

          {showWelcome && (
            <div className="absolute left-3.5 right-3.5 top-[68px] z-10 rounded-[13px] border border-line bg-white p-4 shadow-float md:left-auto md:w-[300px]">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[13.5px] font-semibold tracking-tight">Welcome to the editor</div>
                <button
                  type="button"
                  onClick={dismissWelcome}
                  title="Dismiss"
                  className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-md text-ink-ghost hover:bg-shell hover:text-ink-mid"
                >
                  <X size={13} />
                </button>
              </div>
              <ul className="mt-2.5 flex flex-col gap-2.5">
                <li className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                  <Ruler size={14} className="mt-0.5 flex-none text-action" />
                  <span>
                    Draw walls by clicking points, or after the first click press an arrow key and
                    type an exact length + Enter.
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                  <MousePointerClick size={14} className="mt-0.5 flex-none text-action" />
                  <span>Right-click any wall, room, door, or piece of furniture for quick actions.</span>
                </li>
                <li className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                  <ScanSearch size={14} className="mt-0.5 flex-none text-action" />
                  <span>
                    "Detect rooms from walls" in the panel on the right finds enclosed rooms
                    automatically.
                  </span>
                </li>
              </ul>
              <button
                type="button"
                onClick={dismissWelcome}
                className="mt-3.5 h-[32px] w-full cursor-pointer rounded-[8px] bg-action text-[12.5px] font-semibold text-white hover:bg-action-hover"
              >
                Got it
              </button>
            </div>
          )}

          <div className="absolute left-1/2 top-3.5 z-10 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-[16px] bg-ink px-3.5 py-[7px] text-center text-xs font-medium text-[#E7F0ED] shadow-toast">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#5FD3AE]" />
            {isMobile
              ? TOOL_HINTS[tool].replace('hold Space to pan', 'two-finger drag to pan')
              : TOOL_HINTS[tool]}
          </div>

          <div className="absolute left-3.5 z-10 flex max-w-[calc(100%-28px)] gap-[3px] overflow-x-auto rounded-[11px] border border-line bg-white p-1 shadow-float bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-3.5">
            {floors.map((f) => (
              <div key={f.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void switchFloor(f)}
                  className={`h-11 cursor-pointer rounded-lg px-3 text-[12.5px] font-semibold md:h-8 ${
                    floorId === f.id ? 'bg-brand text-[#D7EFE6]' : 'text-ink-soft hover:bg-shell'
                  } ${floors.length > 1 ? 'pr-6' : ''}`}
                >
                  {f.name}
                </button>
                {floors.length > 1 && (
                  <button
                    type="button"
                    title={confirmDeleteFloorId === f.id ? 'Confirm delete floor' : 'Delete floor'}
                    onClick={() => requestDeleteFloor(f.id)}
                    className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded transition-opacity ${
                      confirmDeleteFloorId === f.id
                        ? 'bg-danger text-white opacity-100'
                        : `opacity-0 group-hover:opacity-100 hover:bg-[#FBF0EF] hover:text-danger ${
                            floorId === f.id ? 'text-[#D7EFE6]' : 'text-ink-ghost'
                          }`
                    }`}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              title="Add floor"
              onClick={() => void addFloor()}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-shell hover:text-ink md:h-8 md:w-8"
            >
              <Plus size={14} strokeWidth={2.2} />
            </button>
            {doc.walls.length > 0 && (
              <button
                type="button"
                title="Copy perimeter to a new floor"
                onClick={() => void addFloorWithPerimeter()}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-shell hover:text-ink md:h-8 md:w-8"
              >
                <Copy size={13} strokeWidth={2.2} />
              </button>
            )}
          </div>

          <div className="absolute right-3.5 z-10 flex gap-2 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-3.5">
            {/* Computed scale: at BASE_PX_PER_MM px/mm and 96dpi, 1m world =
                BASE_PX_PER_MM * 1000 * zoom px on screen. At 96px/inch we have
                3.7795 px/mm on the display. Scale = display_mm / world_mm.
                e.g. zoom=1: 0.06*1000=60px for 1m → 60/3.78≈15.87mm display
                → ratio 1000/15.87≈63 → "1:63". */}
            <span className="hidden rounded-[9px] border border-line bg-white px-3 py-1.5 font-mono text-[11.5px] text-ink-mid shadow-segment md:inline-block">
              1 : {Math.round(1 / (zoom * BASE_PX_PER_MM * (96 / 25.4) * 0.001))}
            </span>
            <button
              type="button"
              onClick={toggleSnap}
              title="Toggle snapping"
              className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-[9px] border border-line bg-white px-3 text-[11.5px] font-semibold shadow-segment md:min-h-0 md:py-1.5 ${
                snapEnabled ? 'text-action-soft-ink' : 'text-ink-ghost'
              }`}
            >
              <Check size={12} strokeWidth={2.5} />
              {snapEnabled ? 'Snap on' : 'Snap off'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setTweaksOpen((o) => !o)}
                title="Display settings"
                className={`flex h-full min-h-[44px] cursor-pointer items-center gap-1.5 rounded-[9px] border border-line bg-white px-3 text-[11.5px] font-semibold shadow-segment md:min-h-0 md:py-1.5 ${
                  tweaksOpen ? 'text-action-soft-ink' : 'text-ink-mid'
                }`}
              >
                <SlidersHorizontal size={12} strokeWidth={2.5} />
                Tweaks
              </button>
              {tweaksOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTweaksOpen(false)} />
                  <div className="absolute bottom-10 right-0 z-50 w-72 rounded-xl border border-line-soft bg-ink p-4 text-white shadow-toast">
                    <div className="text-[11px] font-semibold tracking-[0.07em] text-white/50">STYLE</div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium">Plan mode</span>
                      <SegmentedControl
                        dark
                        options={[
                          { value: 'technical', label: 'Technical' },
                          { value: 'presentation', label: 'Presentation' },
                        ]}
                        value={planMode}
                        onChange={setPlanMode}
                      />
                    </div>
                    <p className="mt-2 text-[11.5px] leading-snug text-white/50">
                      Presentation mode shades each room by type — handy for client-facing plans.
                    </p>

                    <div className="mt-4 border-t border-white/10 pt-3 text-[11px] font-semibold tracking-[0.07em] text-white/50">
                      CANVAS
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium">Grid style</span>
                      <SegmentedControl
                        dark
                        options={[
                          { value: 'dots', label: 'Dots' },
                          { value: 'lines', label: 'Lines' },
                          { value: 'none', label: 'None' },
                        ]}
                        value={gridStyle}
                        onChange={setGridStyle}
                      />
                    </div>
                    <div className="mt-3.5 flex items-center justify-between">
                      <span className="text-[13px] font-medium">Show dimensions</span>
                      <Toggle dark checked={showDimensions} onChange={toggleShowDimensions} title="Show dimensions" />
                    </div>

                    <div className="mt-4 border-t border-white/10 pt-3 text-[11px] font-semibold tracking-[0.07em] text-white/50">
                      LAYERS
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[13px] font-medium">Room area labels</span>
                      <Toggle dark checked={showRoomLabels} onChange={toggleShowRoomLabels} title="Room area labels" />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[13px] font-medium">Furniture symbols</span>
                      <Toggle dark checked={showFurniture} onChange={toggleShowFurniture} title="Furniture symbols" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {!isMobile && (
          <RoomPanel
            onDownloadCsv={() => void downloadCsv()}
            onDownloadEpcCsv={() => void downloadEpcCsv()}
            address={property ? `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}` : ''}
            floors={floors.map((f) => ({ id: f.id, name: f.name, doc: f.doc }))}
            initialTab={searchParams.get('assistant') === '1' ? 'assistant' : 'props'}
          />
        )}
      </div>

      {/* On phones the properties panel becomes a bottom sheet over the
          canvas — a fixed 296px sidebar would leave ~80px of drawing space.
          Opens from the top-bar Properties button, and auto-opens when a
          selection appears (see the selectedCount effect above). */}
      {isMobile && mobilePanelOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[60dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-toast">
          <div className="flex flex-none items-center justify-between border-b border-line-soft px-4 py-1">
            <span className="mx-auto h-1 w-9 rounded-full bg-ink/15" />
            <button
              type="button"
              title="Close panel"
              onClick={() => setMobilePanelOpen(false)}
              className="absolute right-2 top-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-shell"
            >
              <X size={15} />
            </button>
          </div>
          <RoomPanel
            variant="sheet"
            onDownloadCsv={() => void downloadCsv()}
            onDownloadEpcCsv={() => void downloadEpcCsv()}
            address={property ? `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}` : ''}
            floors={floors.map((f) => ({ id: f.id, name: f.name, doc: f.doc }))}
            initialTab={searchParams.get('assistant') === '1' ? 'assistant' : 'props'}
          />
        </div>
      )}

      {exportOpen && property && (
        <ExportModal
          address={`${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}`}
          floorName={activeFloor?.name ?? 'Ground Floor'}
          doc={doc}
          initialPlanMode={planMode}
          onClose={closeExport}
          onExported={() => {
            void setStatus('exported');
            toast('Plan exported');
          }}
        />
      )}
    </div>
  );
}
