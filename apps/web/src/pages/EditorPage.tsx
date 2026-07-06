import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Download,
  HardDrive,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import { deleteEntity, type FloorDoc } from '@floorplan/core';
import type { FloorRecord, PropertyRecord } from '@floorplan/data';
import { EditorCanvas, useEditorStore, ZOOM_STEP } from '@floorplan/editor';
import { BrandMark, StatusPill } from '@floorplan/ui';
import { RoomPanel } from '../components/editor/RoomPanel';
import { ToolPalette, TOOL_HINTS } from '../components/editor/ToolPalette';
import { repos } from '../lib/repos';

const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];

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
      className="flex h-[30px] w-[31px] cursor-pointer items-center justify-center rounded-[7px] text-ink-mid hover:bg-white hover:shadow-segment disabled:cursor-default disabled:text-ink-ghost disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:shadow-none"
    >
      {children}
    </button>
  );
}

export default function EditorPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [floors, setFloors] = useState<FloorRecord[]>([]);
  const [notFound, setNotFound] = useState(false);

  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const fitToView = useEditorStore((s) => s.fitToView);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const saveState = useEditorStore((s) => s.saveState);
  const doc = useEditorStore((s) => s.doc);
  const floorId = useEditorStore((s) => s.floorId);
  const loadFloor = useEditorStore((s) => s.loadFloor);

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
        lastSavedRef.current = first.doc;
        loadFloor(first.id, first.doc);
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
    lastSavedRef.current = fresh.doc;
    loadFloor(fresh.id, fresh.doc);
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
        case 'w':
          store.setTool('wall');
          break;
        case 'r':
          store.setTool('room');
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
          if (store.selectedId) {
            e.preventDefault();
            store.commit('Delete', deleteEntity(store.doc, store.selectedId));
            store.select(null);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <header className="z-20 flex h-[52px] flex-none items-center gap-2.5 border-b border-line bg-white px-3">
        <Link
          to="/"
          title="Back to My Properties"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-ink-mid hover:bg-shell"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
        </Link>
        <BrandMark size={26} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold tracking-tight">
            {property ? `${property.addressLine1}${property.postcode ? `, ${property.postcode}` : ''}` : '…'}
          </span>
          {property && <StatusPill status={property.status} small />}
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

        <div className="flex items-center gap-0.5 rounded-[9px] bg-shell p-0.5">
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

        <div className="flex items-center gap-1.5 px-2.5 text-xs font-medium text-ink-soft">
          <HardDrive size={15} className={saveState === 'saved' ? 'text-success' : 'text-ink-ghost'} />
          {saveState === 'saved' ? 'Saved on this device' : 'Saving…'}
        </div>

        <button
          type="button"
          disabled
          title="Export — coming soon"
          className="flex h-[35px] cursor-not-allowed items-center gap-1.5 rounded-[9px] bg-action px-3.5 text-[13px] font-semibold text-white opacity-50 shadow-cta"
        >
          <Download size={14} strokeWidth={2.2} />
          Export Plan
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
            onPick={setTool}
            className="absolute left-3.5 top-1/2 z-10 -translate-y-1/2"
          />

          <div className="absolute left-1/2 top-3.5 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-3.5 py-[7px] text-xs font-medium text-[#E7F0ED] shadow-toast">
            <span className="h-1.5 w-1.5 rounded-full bg-[#5FD3AE]" />
            {TOOL_HINTS[tool]}
          </div>

          <div className="absolute bottom-3.5 left-3.5 z-10 flex gap-[3px] rounded-[11px] border border-line bg-white p-1 shadow-float">
            {floors.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => void switchFloor(f)}
                className={`h-8 cursor-pointer rounded-lg px-3 text-[12.5px] font-semibold ${
                  floorId === f.id ? 'bg-brand text-[#D7EFE6]' : 'text-ink-soft hover:bg-shell'
                }`}
              >
                {f.name}
              </button>
            ))}
            <button
              type="button"
              title="Add floor"
              onClick={() => void addFloor()}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-shell hover:text-ink"
            >
              <Plus size={14} strokeWidth={2.2} />
            </button>
          </div>

          <div className="absolute bottom-3.5 right-3.5 z-10 flex gap-2">
            <span className="rounded-[9px] border border-line bg-white px-3 py-1.5 font-mono text-[11.5px] text-ink-mid shadow-segment">
              1 : 50
            </span>
            <button
              type="button"
              onClick={toggleSnap}
              title="Toggle snapping"
              className={`flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-semibold shadow-segment ${
                snapEnabled ? 'text-action-soft-ink' : 'text-ink-ghost'
              }`}
            >
              <Check size={12} strokeWidth={2.5} />
              {snapEnabled ? 'Snap on' : 'Snap off'}
            </button>
          </div>
        </div>

        <RoomPanel />
      </div>
    </div>
  );
}
