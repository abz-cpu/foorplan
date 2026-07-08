import { create } from 'zustand';
import {
  docBounds,
  emptyFloorDoc,
  History,
  type FloorDoc,
  type Point,
  type SymbolKind,
} from '@floorplan/core';
import { BASE_PX_PER_MM, ZOOM_MAX, ZOOM_MIN } from './constants';

export type Tool =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'stairs'
  | 'symbol'
  | 'measure'
  | 'text';
export type SaveState = 'saved' | 'saving' | 'unsaved';

export interface Viewport {
  width: number;
  height: number;
}

interface EditorState {
  floorId: string | null;
  doc: FloorDoc;
  tool: Tool;
  /** The single selected id, or the "primary" one when selectedIds.length === 1.
   *  Null whenever zero or more-than-one items are selected — most of the UI
   *  (the Properties panel) only knows how to show a single item's detail. */
  selectedId: string | null;
  /** Every currently selected id — length 0, 1, or many. selectedId is kept
   *  in sync (mirrors the sole entry when there's exactly one). */
  selectedIds: string[];
  zoom: number;
  pan: Point;
  snapEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  viewport: Viewport;
  /** which symbol the symbol tool places */
  symbolKind: SymbolKind;

  loadFloor(floorId: string, doc: FloorDoc): void;
  setTool(tool: Tool): void;
  setSymbolKind(kind: SymbolKind): void;
  select(id: string | null): void;
  /** Add/remove `id` from the current selection (shift/ctrl-click). */
  toggleSelect(id: string, additive: boolean): void;
  /** Replace the whole selection at once (marquee/rubber-band select). */
  selectMany(ids: string[]): void;
  /** Record a completed document change (single undo step). */
  commit(label: string, next: FloorDoc): void;
  undo(): void;
  redo(): void;
  setView(zoom: number, pan: Point): void;
  setPan(pan: Point): void;
  zoomBy(factor: number): void;
  fitToView(): void;
  toggleSnap(): void;
  setViewport(viewport: Viewport): void;
  markSaving(): void;
  markSaved(): void;
}

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const useEditorStore = create<EditorState>((set, get) => {
  // History lives inside the closure so each store instance owns its own
  // history and it is garbage-collected when loadFloor replaces it.
  let history = new History<FloorDoc>();

  return {
    floorId: null,
    doc: emptyFloorDoc(),
    tool: 'select',
    selectedId: null,
    selectedIds: [],
    zoom: 1,
    pan: { x: 80, y: 60 },
    snapEnabled: true,
    canUndo: false,
    canRedo: false,
    saveState: 'saved',
    viewport: { width: 800, height: 600 },
    symbolKind: 'sofa',

    setSymbolKind(kind) {
      set({ symbolKind: kind, tool: 'symbol' });
    },

    loadFloor(floorId, doc) {
      // Replace history — the old instance and all its snapshots are now
      // eligible for garbage collection.
      history = new History<FloorDoc>();
      set({
        floorId,
        doc,
        selectedId: null,
        selectedIds: [],
        canUndo: false,
        canRedo: false,
        saveState: 'saved',
      });
      // NOTE: fitToView() is NOT called here intentionally. The EditorCanvas
      // ResizeObserver calls it after the first real viewport measurement so
      // the calculation uses the actual container dimensions, not the 800×600
      // fallback that would be active at this point in the render cycle.
    },

    setTool(tool) {
      set({ tool });
    },

    select(id) {
      set({ selectedId: id, selectedIds: id ? [id] : [] });
    },

    toggleSelect(id, additive) {
      if (!additive) {
        set({ selectedId: id, selectedIds: [id] });
        return;
      }
      const { selectedIds } = get();
      const next = selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id];
      set({ selectedIds: next, selectedId: next.length === 1 ? next[0] : null });
    },

    selectMany(ids) {
      set({ selectedIds: ids, selectedId: ids.length === 1 ? ids[0] : null });
    },

    commit(label, next) {
      const { doc } = get();
      if (next === doc) return;
      history.push({ label, before: doc, after: next });
      set({ doc: next, canUndo: true, canRedo: false, saveState: 'unsaved' });
    },

    undo() {
      const prev = history.undo();
      if (prev === undefined) return;
      set({
        doc: prev,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        saveState: 'unsaved',
        selectedId: null,
        selectedIds: [],
      });
    },

    redo() {
      const next = history.redo();
      if (next === undefined) return;
      set({
        doc: next,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        saveState: 'unsaved',
        selectedId: null,
        selectedIds: [],
      });
    },

    setView(zoom, pan) {
      set({ zoom: clampZoom(zoom), pan });
    },

    setPan(pan) {
      set({ pan });
    },

    zoomBy(factor) {
      // Zoom around the viewport centre.
      const { zoom, pan, viewport } = get();
      const next = clampZoom(zoom * factor);
      const scale = BASE_PX_PER_MM * zoom;
      const nextScale = BASE_PX_PER_MM * next;
      const cx = viewport.width / 2;
      const cy = viewport.height / 2;
      const worldX = (cx - pan.x) / scale;
      const worldY = (cy - pan.y) / scale;
      set({
        zoom: next,
        pan: { x: cx - worldX * nextScale, y: cy - worldY * nextScale },
      });
    },

    fitToView() {
      const { doc, viewport } = get();
      const bounds = docBounds(doc);
      if (!bounds) {
        set({ zoom: 1, pan: { x: viewport.width / 2, y: viewport.height / 2 } });
        return;
      }
      const spanX = Math.max(bounds.maxX - bounds.minX, 1000);
      const spanY = Math.max(bounds.maxY - bounds.minY, 1000);
      const margin = 80;
      const zoom = clampZoom(
        Math.min(
          (viewport.width - margin * 2) / (spanX * BASE_PX_PER_MM),
          (viewport.height - margin * 2) / (spanY * BASE_PX_PER_MM),
        ),
      );
      const scale = BASE_PX_PER_MM * zoom;
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      set({
        zoom,
        pan: {
          x: viewport.width / 2 - cx * scale,
          y: viewport.height / 2 - cy * scale,
        },
      });
    },

    toggleSnap() {
      set((s) => ({ snapEnabled: !s.snapEnabled }));
    },

    setViewport(viewport) {
      set({ viewport });
    },

    markSaving() {
      set({ saveState: 'saving' });
    },

    markSaved() {
      set({ saveState: 'saved' });
    },
  };
});
