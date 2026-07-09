import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Arc,
  Circle,
  Group,
  Image as KonvaImage,
  Label,
  Layer,
  Line,
  Rect,
  Stage,
  Tag,
  Text,
} from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useToast } from '@floorplan/ui';
import {
  addLabel,
  addOpening,
  addRoom,
  addSymbol,
  addWall,
  clampOpeningOffset,
  DEFAULT_CEILING_HEIGHT_M,
  DEFAULT_DOOR_WIDTH_MM,
  DEFAULT_WALL_THICKNESS_MM,
  EXTERNAL_WALL_THICKNESS_MM,
  DEFAULT_WINDOW_WIDTH_MM,
  deleteEntities,
  distance,
  doorSwingGeometry,
  findWall,
  formatAreaM2,
  formatDims,
  formatMmAsM,
  nearestOffsetOnWall,
  nearestWall,
  newId,
  openingJambs,
  parseLengthToMm,
  pointAlongWall,
  roomAreaM2,
  ROOM_TYPES,
  ROOM_ZONE_COLORS,
  snapPointToGrid,
  snapValueToGrid,
  snapWallEnd,
  SYMBOL_DEFS,
  updateLabel,
  updateOpening,
  updateRoom,
  updateSymbol,
  updateWall,
  wallLengthMm,
  wallNormal,
  wallSegments,
  type Opening,
  type Point,
  type RoomRect,
  type RoomType,
  type SymbolInstance,
  type Wall,
} from '@floorplan/core';
import {
  BASE_PX_PER_MM,
  DISPLAY_GRID_MM,
  ENDPOINT_TOLERANCE_PX,
  GRID_MM,
  MIN_ROOM_MM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from './constants';
import { useEditorStore, type Tool } from './store';

/* Canvas drawing palette — matches the design drafts. */
const WALL = '#1F312C';
const WALL_LIGHT = '#4A5D57';
const ACTION = '#0B7A5E';
const SELECT_FILL = 'rgba(11,122,94,0.08)';
const ROOM_EDGE = '#D8E1DD';
const INK = '#22332F';
const FAINT = '#71827C';
const SANS = "'Instrument Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const DIM_LINE = '#7C9A90';

const PAN_TIP_SEEN_KEY = 'floorplan:seenPanTip';

/** True on touch-first devices (phones/tablets) — used to size grab
 *  handles for fingers instead of a mouse cursor. Evaluated once: a
 *  device's primary pointer doesn't change mid-session. */
const COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const isDraftingTool = (t: Tool) => t === 'room' || t === 'stairs';

/** Furniture symbol rendered from its unit-box primitives inside a rotatable group. */
function SymbolNode({
  sym,
  selected,
  isMultiSelected,
  draggable,
  onSelect,
  onMove,
  onGroupDragStart,
  onGroupDragEnd,
}: {
  sym: SymbolInstance;
  selected: boolean;
  /** True when this symbol is one of 2+ currently-selected entities —
   *  dragging it then moves the whole selection instead of collapsing to
   *  just this symbol. */
  isMultiSelected: boolean;
  draggable: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (x: number, y: number) => void;
  onGroupDragStart: (x: number, y: number) => void;
  onGroupDragEnd: (x: number, y: number) => void;
}) {
  const def = SYMBOL_DEFS[sym.kind];
  const sx = sym.w / 100;
  const sy = sym.h / 100;
  const mirrored = sym.mirrored ?? false;
  const mx = (ux: number) => (mirrored ? 100 - ux : ux);
  const stroke = selected ? ACTION : WALL_LIGHT;
  return (
    <Group
      x={sym.x + sym.w / 2}
      y={sym.y + sym.h / 2}
      offsetX={sym.w / 2}
      offsetY={sym.h / 2}
      rotation={sym.rotationDeg}
      draggable={draggable}
      onClick={(e) => onSelect(e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)}
      onTap={() => onSelect(false)}
      onDragStart={() => {
        if (isMultiSelected) onGroupDragStart(sym.x, sym.y);
        else onSelect(false);
      }}
      onDragEnd={(e) => {
        if (isMultiSelected) onGroupDragEnd(e.target.x() - sym.w / 2, e.target.y() - sym.h / 2);
        else onMove(e.target.x() - sym.w / 2, e.target.y() - sym.h / 2);
      }}
    >
      {/* hit region */}
      <Rect width={sym.w} height={sym.h} fill="rgba(0,0,0,0.001)" />
      {def.prims.map((p, i) => {
        if (p.t === 'line') {
          return (
            <Line
              key={i}
              points={[mx(p.x1) * sx, p.y1 * sy, mx(p.x2) * sx, p.y2 * sy]}
              stroke={stroke}
              strokeWidth={22}
              listening={false}
            />
          );
        }
        if (p.t === 'rect') {
          const rectX = mirrored ? 100 - (p.x + p.w) : p.x;
          return (
            <Rect
              key={i}
              x={rectX * sx}
              y={p.y * sy}
              width={p.w * sx}
              height={p.h * sy}
              stroke={stroke}
              strokeWidth={22}
              listening={false}
            />
          );
        }
        return (
          <Circle
            key={i}
            x={mx(p.cx) * sx}
            y={p.cy * sy}
            radius={p.r * Math.min(sx, sy)}
            stroke={stroke}
            strokeWidth={22}
            listening={false}
          />
        );
      })}
    </Group>
  );
}

function StairsTreads({ room }: { room: RoomRect }) {
  const horizontal = room.w >= room.h;
  const reversed = room.stairDirection === 'reversed';
  const spacing = 280;
  const treads: number[] = [];
  if (horizontal) {
    for (let x = spacing; x < room.w - 40; x += spacing) treads.push(x);
  } else {
    for (let y = spacing; y < room.h - 40; y += spacing) treads.push(y);
  }
  // The arrow shaft runs from `shaftFrom` to `shaftTo` along the long axis;
  // the chevron sits at `shaftTo` (the "up"/travel-direction end) with its
  // wings trailing back toward `wingBack`. Flipping `reversed` swaps which
  // end is which, so the whole arrow points the other way.
  const dim = horizontal ? room.w : room.h;
  const shaftFrom = reversed ? dim - 120 : 120;
  const shaftTo = reversed ? 200 : dim - 200;
  const wingBack = reversed ? shaftTo + 120 : shaftTo - 120;
  return (
    <>
      {treads.map((t) => (
        <Line
          key={t}
          points={horizontal ? [t, 0, t, room.h] : [0, t, room.w, t]}
          stroke={WALL_LIGHT}
          strokeWidth={16}
          listening={false}
        />
      ))}
      {horizontal ? (
        <>
          <Line points={[shaftFrom, room.h / 2, shaftTo, room.h / 2]} stroke={INK} strokeWidth={22} listening={false} />
          <Line
            points={[wingBack, room.h / 2 - 110, shaftTo, room.h / 2, wingBack, room.h / 2 + 110]}
            stroke={INK}
            strokeWidth={22}
            listening={false}
          />
        </>
      ) : (
        <>
          <Line points={[room.w / 2, shaftFrom, room.w / 2, shaftTo]} stroke={INK} strokeWidth={22} listening={false} />
          <Line
            points={[room.w / 2 - 110, wingBack, room.w / 2, shaftTo, room.w / 2 + 110, wingBack]}
            stroke={INK}
            strokeWidth={22}
            listening={false}
          />
        </>
      )}
    </>
  );
}

function OpeningShape({
  wall,
  opening,
  selected,
  onSelect,
  onGrab,
}: {
  wall: Wall;
  opening: Opening;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onGrab: () => void;
}) {
  const { start, end } = openingJambs(wall, opening);
  const n = wallNormal(wall);
  const t = wall.thickness;
  const color = selected ? ACTION : WALL;
  const colorLight = selected ? ACTION : WALL_LIGHT;

  const parts: React.ReactNode[] = [];
  if (opening.kind === 'window') {
    for (const s of [t * 0.28, -t * 0.28]) {
      parts.push(
        <Line
          key={`w${s}`}
          points={[start.x + n.x * s, start.y + n.y * s, end.x + n.x * s, end.y + n.y * s]}
          stroke={color}
          strokeWidth={22}
          listening={false}
        />,
      );
    }
    for (const p of [start, end]) {
      parts.push(
        <Line
          key={`j${p.x},${p.y}`}
          points={[p.x + n.x * (t / 2), p.y + n.y * (t / 2), p.x - n.x * (t / 2), p.y - n.y * (t / 2)]}
          stroke={color}
          strokeWidth={22}
          listening={false}
        />,
      );
    }
  } else {
    const { hinge, tip, startDeg, endDeg, delta } = doorSwingGeometry(wall, opening);
    parts.push(
      <Line
        key="leaf"
        points={[hinge.x, hinge.y, tip.x, tip.y]}
        stroke={colorLight}
        strokeWidth={25}
        listening={false}
      />,
      <Arc
        key="swing"
        x={hinge.x}
        y={hinge.y}
        innerRadius={opening.widthMm}
        outerRadius={opening.widthMm}
        angle={Math.abs(delta)}
        rotation={delta >= 0 ? startDeg : endDeg}
        stroke={colorLight}
        strokeWidth={20}
        listening={false}
      />,
    );
  }

  return (
    <Group>
      {parts}
      {/* invisible grab/hit region across the opening */}
      <Line
        points={[start.x, start.y, end.x, end.y]}
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={Math.max(t * 3, 360)}
        onClick={(e) => onSelect(e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)}
        onTap={() => onSelect(false)}
        onMouseDown={onGrab}
        onTouchStart={onGrab}
      />
    </Group>
  );
}

export function EditorCanvas({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const toast = useToast();

  const doc = useEditorStore((s) => s.doc);
  const tool = useEditorStore((s) => s.tool);
  const symbolKind = useEditorStore((s) => s.symbolKind);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const viewport = useEditorStore((s) => s.viewport);
  const gridStyle = useEditorStore((s) => s.gridStyle);
  const showDimensions = useEditorStore((s) => s.showDimensions);
  const showRoomLabels = useEditorStore((s) => s.showRoomLabels);
  const showFurniture = useEditorStore((s) => s.showFurniture);
  const planMode = useEditorStore((s) => s.planMode);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const selectMany = useEditorStore((s) => s.selectMany);
  const commit = useEditorStore((s) => s.commit);
  const setView = useEditorStore((s) => s.setView);
  const setPan = useEditorStore((s) => s.setPan);
  const setViewport = useEditorStore((s) => s.setViewport);

  const scale = BASE_PX_PER_MM * zoom;

  /* Draft interaction state */
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [hoverPt, setHoverPt] = useState<Point | null>(null);
  const [rectDraft, setRectDraft] = useState<{ a: Point; b: Point; stairs: boolean } | null>(null);
  const [resizeDraft, setResizeDraft] = useState<RoomRect | null>(null);
  const [wallEndDraft, setWallEndDraft] = useState<{ id: string; a: Point; b: Point } | null>(null);
  // Group-drag: dragging any one member of a multi-selection moves the
  // whole selection together instead of collapsing to just that one item.
  // Holds the grabbed shape's own pre-drag x/y (in whatever coordinate
  // convention that shape's own Konva node uses); the delta between that
  // and its drop position is applied identically to every selected entity.
  const [groupDragOrigin, setGroupDragOrigin] = useState<Point | null>(null);
  const [openingHover, setOpeningHover] = useState<{ wall: Wall; offsetMm: number } | null>(null);
  const [openingDraft, setOpeningDraft] = useState<{ id: string; offsetMm: number } | null>(null);
  const [measureA, setMeasureA] = useState<Point | null>(null);
  const [underlayImg, setUnderlayImg] = useState<HTMLImageElement | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  /* Wall tool: press X mid-draw to flip the pending wall between internal
     (100mm) and external (200mm) — no more drawing first and re-typing the
     thickness afterwards. */
  const [drawExternal, setDrawExternal] = useState(false);
  /* "Laser measure" keyboard wall entry: an arrow key locks a direction
     from the current chain point, digits type an exact length, Enter
     shoots the wall out and continues the chain. */
  const [keyedDirection, setKeyedDirection] = useState<Point | null>(null);
  const [keyedLength, setKeyedLength] = useState('');
  /* Right-click contextual action menu — screen coords are relative to the
     canvas container, same space getPointerPosition() returns, so it can be
     positioned with plain CSS left/top alongside the Stage. */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
    kind: 'room' | 'wall' | 'opening' | 'symbol' | 'label';
  } | null>(null);
  const panDrag = useRef<{ pointer: Point; pan: Point } | null>(null);
  const pinch = useRef<{ dist: number; center: Point } | null>(null);
  const openingDrag = useRef<{ id: string; wallId: string } | null>(null);

  /* Hold Space to pan (matches most design-tool conventions) — otherwise a
     drag on empty canvas with the Select tool draws a marquee-select box. */
  useEffect(() => {
    const isTyping = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* Close the right-click context menu on Escape, or whenever the active
     tool changes (switching tools mid-menu should cancel it). */
  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextMenu]);

  useEffect(() => {
    setContextMenu(null);
  }, [tool, doc]);

  /* X toggles internal/external for the wall being drawn (Wall tool only,
     ignored while typing in a field). */
  useEffect(() => {
    if (tool !== 'wall') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key.toLowerCase() === 'x') setDrawExternal((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool]);

  const drawThickness = drawExternal ? EXTERNAL_WALL_THICKNESS_MM : DEFAULT_WALL_THICKNESS_MM;

  /* Laser-measure keyboard wall entry — only listens while the Wall tool is
     active and a chain is in progress (there's a fixed start point to
     extend from). */
  useEffect(() => {
    if (tool !== 'wall' || !wallStart) return;
    const DIRECTIONS: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const dir = DIRECTIONS[e.key];
      if (dir) {
        e.preventDefault();
        setKeyedDirection(dir);
        setKeyedLength('');
        return;
      }
      if (!keyedDirection) return; // no direction locked yet — plain mouse drawing

      if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        setKeyedLength((s) => s + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setKeyedLength((s) => s.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const mm = parseLengthToMm(keyedLength);
        if (mm !== null && mm >= 10) {
          const endpoint = {
            x: wallStart.x + keyedDirection.x * mm,
            y: wallStart.y + keyedDirection.y * mm,
          };
          commit(
            'Draw wall',
            addWall(doc, { id: newId(), a: wallStart, b: endpoint, thickness: drawThickness }),
          );
          setWallStart(endpoint);
          setHoverPt(endpoint);
        }
        setKeyedDirection(null);
        setKeyedLength('');
      } else if (e.key === 'Escape') {
        setKeyedDirection(null);
        setKeyedLength('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, wallStart, keyedDirection, keyedLength, doc, commit, drawThickness]);

  /* Load the underlay image whenever it changes */
  const underlayUrl = doc.underlay?.dataUrl ?? null;
  useEffect(() => {
    if (!underlayUrl) {
      setUnderlayImg(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setUnderlayImg(img);
    img.src = underlayUrl;
  }, [underlayUrl]);

  /* Track container size — also triggers the initial fit-to-view once the
     ResizeObserver delivers the first real measurement. Using a ref flag so
     we only auto-fit on mount, not on every subsequent resize (e.g. panel
     open/close), which would jar the user mid-draw. */
  const didInitialFit = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
      if (!didInitialFit.current) {
        didInitialFit.current = true;
        // Defer one micro-task so the store's viewport state has settled
        // before fitToView reads it.
        setTimeout(() => useEditorStore.getState().fitToView(), 0);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  /**
   * iOS Safari fires non-standard `gesture*` events for pinch/rotate that
   * bypass `touch-action: none` and the viewport's `user-scalable=no` on
   * some iOS versions — the canvas has its own pinch-zoom (onTouchMove
   * above), so the page-level gesture must be suppressed or the two fight.
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', prevent);
    el.addEventListener('gesturechange', prevent);
    el.addEventListener('gestureend', prevent);
    return () => {
      el.removeEventListener('gesturestart', prevent);
      el.removeEventListener('gesturechange', prevent);
      el.removeEventListener('gestureend', prevent);
    };
  }, []);

  const clearDrafts = useCallback(() => {
    setWallStart(null);
    setHoverPt(null);
    setRectDraft(null);
    setResizeDraft(null);
    setOpeningHover(null);
    setOpeningDraft(null);
    setMeasureA(null);
    setMarqueeDraft(null);
    setKeyedDirection(null);
    setKeyedLength('');
    openingDrag.current = null;
  }, []);

  /* Reset drafts when the tool changes */
  useEffect(() => {
    clearDrafts();
  }, [tool, clearDrafts]);

  /* Escape cancels drafts and selection */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      clearDrafts();
      select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, clearDrafts]);

  const toWorld = useCallback(
    (screen: Point): Point => ({
      x: (screen.x - pan.x) / scale,
      y: (screen.y - pan.y) / scale,
    }),
    [pan, scale],
  );

  const pointerWorld = useCallback((): Point | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? toWorld(p) : null;
  }, [toWorld]);

  const snapEnd = useCallback(
    (raw: Point, start: Point | null): Point =>
      snapWallEnd(raw, start, {
        gridMm: snapEnabled ? GRID_MM : 1,
        endpoints: doc.walls.flatMap((w) => [w.a, w.b]),
        endpointToleranceMm: ENDPOINT_TOLERANCE_PX / scale,
        orthoToleranceDeg: snapEnabled ? 7 : 0,
      }),
    [doc, scale, snapEnabled],
  );

  // Reshaping an already-drawn wall (dragging its endpoint handle) should
  // move freely in any direction, same as dragging a room — only drawing a
  // *new* wall gets the ortho-snap-to-horizontal/vertical assist above.
  // orthoSnap pulls toward horizontal/vertical measured from the wall's
  // fixed other end, which — reused unchanged here — trapped the dragged
  // end in a narrow cone along the original axis, making it feel like it
  // could only slide straight back/forward and never break out diagonally.
  const snapEndFree = useCallback(
    (raw: Point, start: Point | null): Point =>
      snapWallEnd(raw, start, {
        gridMm: snapEnabled ? GRID_MM : 1,
        endpoints: doc.walls.flatMap((w) => [w.a, w.b]),
        endpointToleranceMm: ENDPOINT_TOLERANCE_PX / scale,
        orthoToleranceDeg: 0,
      }),
    [doc, scale, snapEnabled],
  );

  const snapFree = useCallback(
    (raw: Point): Point => (snapEnabled ? snapPointToGrid(raw, GRID_MM) : raw),
    [snapEnabled],
  );

  // Floored at 150mm so a thin (100mm) internal wall stays reliably
  // clickable even at max zoom, where 24/scale alone would shrink below
  // the wall's own thickness.
  const wallHitToleranceMm = Math.max(24 / scale, 150);

  // Rooms and stairs are both plain RoomRects sharing doc.rooms, so a click
  // inside a room can also land inside a smaller stairs (or other room)
  // rect nested within it. Konva's paint-order hit-testing would always
  // resolve that to whichever is later in the array — instead, pick the
  // smallest-area room/stairs whose bounding box actually contains the
  // click, so a nested/smaller shape is always reachable regardless of
  // draw order.
  const pickRoomAt = useCallback(
    (p: Point): RoomRect | undefined => {
      let best: RoomRect | undefined;
      let bestArea = Infinity;
      for (const room of doc.rooms) {
        const r = resizeDraft?.id === room.id ? resizeDraft : room;
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
          const area = r.w * r.h;
          if (area < bestArea) {
            bestArea = area;
            best = room;
          }
        }
      }
      return best;
    },
    [doc.rooms, resizeDraft],
  );

  // What's under a point, for the right-click context menu — checked in
  // roughly visual stacking order (small/specific things before the room
  // fill that sits behind everything).
  const pickEntityAt = useCallback(
    (p: Point): { id: string; kind: 'room' | 'wall' | 'opening' | 'symbol' | 'label' } | undefined => {
      for (let i = doc.symbols.length - 1; i >= 0; i--) {
        const s = doc.symbols[i];
        if (p.x >= s.x - 50 && p.x <= s.x + s.w + 50 && p.y >= s.y - 50 && p.y <= s.y + s.h + 50) {
          return { id: s.id, kind: 'symbol' };
        }
      }
      for (let i = doc.labels.length - 1; i >= 0; i--) {
        const l = doc.labels[i];
        if (p.x >= l.x - 300 && p.x <= l.x + 300 && p.y >= l.y - 150 && p.y <= l.y + 150) {
          return { id: l.id, kind: 'label' };
        }
      }
      const hit = nearestWall(doc, p, wallHitToleranceMm);
      if (hit) {
        const opening = doc.openings.find(
          (o) => o.wallId === hit.wall.id && Math.abs(hit.offsetMm - o.offsetMm) <= o.widthMm / 2 + 100,
        );
        if (opening) return { id: opening.id, kind: 'opening' };
        return { id: hit.wall.id, kind: 'wall' };
      }
      const room = pickRoomAt(p);
      if (room) return { id: room.id, kind: 'room' };
      return undefined;
    },
    [doc, wallHitToleranceMm, pickRoomAt],
  );

  // Furniture wall-alignment anchor: placing or dragging a symbol within
  // reach of a wall snaps it flush against the wall's face and rotates it
  // so its back (every symbol is authored with its back edge at local
  // y=0 — the headboard end of a bed, the backrest of a sofa, etc.) faces
  // that wall, on whichever side of the wall the point actually sits.
  const alignToNearbyWall = useCallback(
    (p: Point, w: number, h: number): { x: number; y: number; rotationDeg: number } | null => {
      const hit = nearestWall(doc, p, h / 2 + 400);
      if (!hit) return null;
      const n = wallNormal(hit.wall);
      const wallPt = pointAlongWall(hit.wall, hit.offsetMm);
      const toP = { x: p.x - wallPt.x, y: p.y - wallPt.y };
      const dot = toP.x * n.x + toP.y * n.y;
      // roomNormal points from the wall out into whichever room `p` is in.
      const roomNormal = dot >= 0 ? n : { x: -n.x, y: -n.y };
      const backDir = { x: -roomNormal.x, y: -roomNormal.y };
      const rotationDeg = ((Math.atan2(backDir.x, -backDir.y) * 180) / Math.PI + 360) % 360;
      const faceX = wallPt.x + roomNormal.x * (hit.wall.thickness / 2);
      const faceY = wallPt.y + roomNormal.y * (hit.wall.thickness / 2);
      const centerX = faceX + roomNormal.x * (h / 2);
      const centerY = faceY + roomNormal.y * (h / 2);
      return { x: centerX - w / 2, y: centerY - h / 2, rotationDeg };
    },
    [doc],
  );

  // Marquee (rubber-band) select: returns every entity whose bounding box
  // overlaps the drag rectangle, across all five entity types. A simple AABB
  // overlap test — good enough for "select everything roughly in this area"
  // without needing exact shape intersection.
  const entitiesInRect = useCallback(
    (a: Point, b: Point): string[] => {
      const rMinX = Math.min(a.x, b.x);
      const rMaxX = Math.max(a.x, b.x);
      const rMinY = Math.min(a.y, b.y);
      const rMaxY = Math.max(a.y, b.y);
      const overlaps = (minX: number, minY: number, maxX: number, maxY: number) =>
        minX <= rMaxX && maxX >= rMinX && minY <= rMaxY && maxY >= rMinY;

      const ids: string[] = [];
      for (const room of doc.rooms) {
        if (overlaps(room.x, room.y, room.x + room.w, room.y + room.h)) ids.push(room.id);
      }
      for (const w of doc.walls) {
        if (
          overlaps(
            Math.min(w.a.x, w.b.x),
            Math.min(w.a.y, w.b.y),
            Math.max(w.a.x, w.b.x),
            Math.max(w.a.y, w.b.y),
          )
        )
          ids.push(w.id);
      }
      for (const o of doc.openings) {
        const wall = findWall(doc, o.wallId);
        if (!wall) continue;
        const { start, end } = openingJambs(wall, o);
        if (
          overlaps(
            Math.min(start.x, end.x),
            Math.min(start.y, end.y),
            Math.max(start.x, end.x),
            Math.max(start.y, end.y),
          )
        )
          ids.push(o.id);
      }
      for (const s of doc.symbols) {
        if (overlaps(s.x, s.y, s.x + s.w, s.y + s.h)) ids.push(s.id);
      }
      for (const l of doc.labels) {
        // Labels have no stored width — a small margin around the anchor
        // point is close enough for "is this label roughly in the box".
        if (overlaps(l.x - 300, l.y - 150, l.x + 300, l.y + 150)) ids.push(l.id);
      }
      return ids;
    },
    [doc],
  );

  /* ---- shared pointer logic (mouse + single touch) ---- */

  const pointerDown = (isStageTarget: boolean, screen: Point) => {
    // Dedicated hand tool: any drag pans, no matter what's under the
    // pointer — the discoverable, on-screen equivalent of Space+drag.
    if (tool === 'pan') {
      panDrag.current = { pointer: screen, pan };
      return;
    }
    if (tool === 'select' && isStageTarget) {
      if (spacePressed) {
        panDrag.current = { pointer: screen, pan };
        return;
      }
      const raw = pointerWorld();
      if (raw) setMarqueeDraft({ a: raw, b: raw });
      select(null);
      return;
    }
    const raw = pointerWorld();
    if (!raw) return;

    if (tool === 'wall') {
      const pt = snapEnd(raw, wallStart);
      if (!wallStart) {
        setWallStart(pt);
        setHoverPt(pt);
      } else if (distance(wallStart, pt) >= 10) {
        commit(
          'Draw wall',
          addWall(doc, { id: newId(), a: wallStart, b: pt, thickness: drawThickness }),
        );
        setWallStart(pt);
        setHoverPt(pt);
      } else {
        // Clicking the current chain point again finishes the chain.
        // (Konva's own dblclick fires for any two clicks within 400ms even at
        // different positions, which would break fast chain-drawing — so chain
        // termination is position-based instead.)
        setWallStart(null);
        setHoverPt(pt);
      }
    } else if (isDraftingTool(tool)) {
      const a = snapFree(raw);
      setRectDraft({ a, b: a, stairs: tool === 'stairs' });
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(doc, raw, wallHitToleranceMm);
      if (!hit) return;
      const width = tool === 'door' ? DEFAULT_DOOR_WIDTH_MM : DEFAULT_WINDOW_WIDTH_MM;
      const offset = clampOpeningOffset(
        hit.wall,
        snapEnabled ? snapValueToGrid(hit.offsetMm, GRID_MM) : hit.offsetMm,
        width,
      );
      // Default a new door to swing into whichever side actually has a
      // room, so it opens like a real door rather than always toward
      // wallNormal's fixed direction. Ambiguous cases (rooms on both
      // sides, or neither — nothing detected yet) keep the 'a' default;
      // "Flip swing side" is always available to override by hand.
      let swingSide: 'a' | 'b' = 'a';
      if (tool === 'door') {
        const n = wallNormal(hit.wall);
        const wallPt = pointAlongWall(hit.wall, hit.offsetMm);
        const margin = hit.wall.thickness / 2 + 150;
        const aHasRoom = !!pickRoomAt({ x: wallPt.x + n.x * margin, y: wallPt.y + n.y * margin });
        const bHasRoom = !!pickRoomAt({ x: wallPt.x - n.x * margin, y: wallPt.y - n.y * margin });
        if (!aHasRoom && bHasRoom) swingSide = 'b';
      }
      const opening: Opening = {
        id: newId(),
        wallId: hit.wall.id,
        kind: tool,
        offsetMm: offset,
        widthMm: width,
        hinge: 'left',
        swingSide,
      };
      commit(tool === 'door' ? 'Place door' : 'Place window', addOpening(doc, opening));
      select(opening.id);
      setOpeningHover(null);
    } else if (tool === 'symbol') {
      const def = SYMBOL_DEFS[symbolKind];
      const aligned = alignToNearbyWall(raw, def.w, def.h);
      const centre = snapFree(raw);
      const sym: SymbolInstance = {
        id: newId(),
        kind: symbolKind,
        x: aligned ? aligned.x : centre.x - def.w / 2,
        y: aligned ? aligned.y : centre.y - def.h / 2,
        w: def.w,
        h: def.h,
        rotationDeg: aligned ? aligned.rotationDeg : 0,
      };
      commit(`Place ${def.name.toLowerCase()}`, addSymbol(doc, sym));
      select(sym.id);
    } else if (tool === 'measure') {
      const pt = snapFree(raw);
      if (!measureA) {
        setMeasureA(pt);
        setHoverPt(pt);
      } else {
        setMeasureA(null);
        setHoverPt(null);
      }
    } else if (tool === 'text') {
      const pt = snapFree(raw);
      const label = { id: newId(), x: pt.x, y: pt.y, text: 'Label' };
      commit('Add label', addLabel(doc, label));
      select(label.id);
    }
  };

  const pointerMove = (screen: Point) => {
    if (panDrag.current) {
      setPan({
        x: panDrag.current.pan.x + (screen.x - panDrag.current.pointer.x),
        y: panDrag.current.pan.y + (screen.y - panDrag.current.pointer.y),
      });
      return;
    }
    if (marqueeDraft) {
      const raw = pointerWorld();
      if (raw) setMarqueeDraft({ a: marqueeDraft.a, b: raw });
      return;
    }
    if (openingDrag.current) {
      const raw = pointerWorld();
      const wall = findWall(doc, openingDrag.current.wallId);
      if (raw && wall) {
        setOpeningDraft({
          id: openingDrag.current.id,
          offsetMm: snapEnabled
            ? snapValueToGrid(nearestOffsetOnWall(wall, raw), GRID_MM)
            : nearestOffsetOnWall(wall, raw),
        });
      }
      return;
    }
    if (tool === 'wall') {
      const raw = pointerWorld();
      if (raw) setHoverPt(snapEnd(raw, wallStart));
    } else if (tool === 'measure' && measureA) {
      const raw = pointerWorld();
      if (raw) setHoverPt(snapFree(raw));
    } else if (isDraftingTool(tool) && rectDraft) {
      const raw = pointerWorld();
      if (raw) setRectDraft({ ...rectDraft, b: snapFree(raw) });
    } else if (tool === 'door' || tool === 'window') {
      const raw = pointerWorld();
      if (raw) {
        const hit = nearestWall(doc, raw, wallHitToleranceMm);
        setOpeningHover(hit ? { wall: hit.wall, offsetMm: hit.offsetMm } : null);
      }
    }
  };

  const pointerUp = () => {
    panDrag.current = null;

    if (marqueeDraft) {
      // Distinguish an intentional drag from a plain click (which should
      // just deselect, already done in pointerDown) using a small screen-
      // space threshold converted to world units.
      const movedMm = distance(marqueeDraft.a, marqueeDraft.b);
      if (movedMm >= 6 / scale) {
        const hits = entitiesInRect(marqueeDraft.a, marqueeDraft.b);
        selectMany(hits);
        // A deliberate drag that ends up selecting nothing is the exact
        // failure mode of a first-time user trying to pan by dragging
        // empty space instead of holding Space — the static toolbar hint
        // alone was easy to miss, so surface it again, once, right when it
        // would actually help.
        if (hits.length === 0 && localStorage.getItem(PAN_TIP_SEEN_KEY) !== '1') {
          localStorage.setItem(PAN_TIP_SEEN_KEY, '1');
          toast(
            COARSE_POINTER
              ? 'Nothing there — drag with two fingers to pan the canvas'
              : 'Nothing there — hold Space and drag to pan the canvas',
          );
        }
      }
      setMarqueeDraft(null);
      return;
    }

    if (openingDrag.current && openingDraft) {
      const wall = findWall(doc, openingDrag.current.wallId);
      const opening = doc.openings.find((o) => o.id === openingDrag.current?.id);
      if (wall && opening) {
        const clamped = clampOpeningOffset(wall, openingDraft.offsetMm, opening.widthMm);
        if (clamped !== opening.offsetMm) {
          commit('Move opening', updateOpening(doc, opening.id, { offsetMm: clamped }));
        }
      }
      openingDrag.current = null;
      setOpeningDraft(null);
      return;
    }
    openingDrag.current = null;

    if (isDraftingTool(tool) && rectDraft) {
      const x = Math.min(rectDraft.a.x, rectDraft.b.x);
      const y = Math.min(rectDraft.a.y, rectDraft.b.y);
      const w = Math.abs(rectDraft.b.x - rectDraft.a.x);
      const h = Math.abs(rectDraft.b.y - rectDraft.a.y);
      if (w >= MIN_ROOM_MM && h >= MIN_ROOM_MM) {
        const stairs = rectDraft.stairs;
        const room: RoomRect = {
          id: newId(),
          x,
          y,
          w,
          h,
          name: stairs ? 'Stairs' : `Room ${doc.rooms.length + 1}`,
          type: stairs ? 'Stairs' : 'Other',
          ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
          includeInGia: !stairs,
        };
        commit(stairs ? 'Add stairs' : 'Add room', addRoom(doc, room));
        select(room.id);
      }
      setRectDraft(null);
    }
  };

  /* ---- mouse events ---- */

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    setContextMenu(null);
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      panDrag.current = { pointer: { x: e.evt.clientX, y: e.evt.clientY }, pan };
      return;
    }
    if (e.evt.button !== 0) return;
    pointerDown(e.target === stageRef.current, { x: e.evt.clientX, y: e.evt.clientY });
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    pointerMove({ x: e.evt.clientX, y: e.evt.clientY });
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const factor = e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const nextZoom = clampZoom(zoom * factor);
    const nextScale = BASE_PX_PER_MM * nextZoom;
    const world = toWorld(pointer);
    setView(nextZoom, {
      x: pointer.x - world.x * nextScale,
      y: pointer.y - world.y * nextScale,
    });
  };

  /* ---- touch events (single = pointer, double = pinch zoom/pan) ---- */

  const touchCenterDist = (t: TouchList) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const p1 = { x: t[0].clientX, y: t[0].clientY };
    const p2 = { x: t[1].clientX, y: t[1].clientY };
    return {
      center: { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top },
      dist: Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), 1),
    };
  };

  const onTouchStart = (e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length === 2) {
      e.evt.preventDefault();
      pinch.current = touchCenterDist(e.evt.touches);
      setRectDraft(null);
      return;
    }
    // Cancel the compatibility mouse events browsers synthesize after a tap
    // (mousedown/mouseup/click) — without this, pointerDown runs a second
    // time for the same tap via onMouseDown, and stateful tools break: the
    // wall tool's "tap the chain point again to finish" check sees the
    // duplicate zero-distance call and instantly ends the chain the touch
    // just started, making it impossible to draw walls by touch at all.
    // Konva's own tap/drag synthesis works from the touch events directly,
    // so shape selection and dragging are unaffected.
    if (e.evt.cancelable) e.evt.preventDefault();
    const t = e.evt.touches[0];
    pointerDown(e.target === stageRef.current, { x: t.clientX, y: t.clientY });
  };

  const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length === 2) {
      e.evt.preventDefault();
      const { center, dist } = touchCenterDist(e.evt.touches);
      if (!pinch.current) {
        pinch.current = { center, dist };
        return;
      }
      const nextZoom = clampZoom(zoom * (dist / pinch.current.dist));
      const nextScale = BASE_PX_PER_MM * nextZoom;
      const world = toWorld(pinch.current.center);
      setView(nextZoom, {
        x: center.x - world.x * nextScale,
        y: center.y - world.y * nextScale,
      });
      pinch.current = { center, dist };
      return;
    }
    const t = e.evt.touches[0];
    if (t) pointerMove({ x: t.clientX, y: t.clientY });
  };

  const onTouchEnd = () => {
    pinch.current = null;
    pointerUp();
  };

  const endWallChain = () => {
    setWallStart(null);
    setHoverPt(null);
  };

  /** Translate every currently-selected room/wall/symbol/label by the same
   *  (dx, dy) in one undo step. Openings move implicitly — their offsetMm
   *  is relative to their wall's endpoints, which shift together. */
  const commitGroupMove = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    let next = doc;
    for (const id of selectedIds) {
      const room = next.rooms.find((r) => r.id === id);
      if (room) {
        next = updateRoom(next, id, { x: room.x + dx, y: room.y + dy });
        continue;
      }
      const wall = next.walls.find((w) => w.id === id);
      if (wall) {
        next = updateWall(next, id, {
          a: { x: wall.a.x + dx, y: wall.a.y + dy },
          b: { x: wall.b.x + dx, y: wall.b.y + dy },
        });
        continue;
      }
      const sym = next.symbols.find((s) => s.id === id);
      if (sym) {
        next = updateSymbol(next, id, { x: sym.x + dx, y: sym.y + dy });
        continue;
      }
      const label = next.labels.find((l) => l.id === id);
      if (label) next = updateLabel(next, id, { x: label.x + dx, y: label.y + dy });
    }
    commit('Move selection', next);
  };

  /* ---- render helpers ---- */

  const selectedRoom = doc.rooms.find((r) => r.id === selectedId) ?? null;
  const selectedWall = doc.walls.find((w) => w.id === selectedId) ?? null;
  // 10px handles are fine under a mouse cursor but nearly impossible to
  // grab with a finger — on coarse pointers (touch screens) render them at
  // 24px so resize/reshape works on phones and tablets.
  const handleHalf = (COARSE_POINTER ? 12 : 5) / scale;

  const renderResizeHandles = (room: RoomRect) => {
    const r = resizeDraft?.id === room.id ? resizeDraft : room;
    const corners = [
      { cx: r.x, cy: r.y, ox: r.x + r.w, oy: r.y + r.h },
      { cx: r.x + r.w, cy: r.y, ox: r.x, oy: r.y + r.h },
      { cx: r.x, cy: r.y + r.h, ox: r.x + r.w, oy: r.y },
      { cx: r.x + r.w, cy: r.y + r.h, ox: r.x, oy: r.y },
    ];
    return corners.map((c, i) => (
      <Rect
        key={`handle-${i}`}
        x={c.cx - handleHalf}
        y={c.cy - handleHalf}
        width={handleHalf * 2}
        height={handleHalf * 2}
        fill="#FFFFFF"
        stroke={ACTION}
        strokeWidth={2 / scale}
        draggable
        onDragMove={(e) => {
          const px = e.target.x() + handleHalf;
          const py = e.target.y() + handleHalf;
          const snapped = snapFree({ x: px, y: py });
          let nx = snapped.x;
          let ny = snapped.y;
          if (Math.abs(nx - c.ox) < MIN_ROOM_MM) nx = c.ox + Math.sign(nx - c.ox || 1) * MIN_ROOM_MM;
          if (Math.abs(ny - c.oy) < MIN_ROOM_MM) ny = c.oy + Math.sign(ny - c.oy || 1) * MIN_ROOM_MM;
          setResizeDraft({
            ...room,
            x: Math.min(nx, c.ox),
            y: Math.min(ny, c.oy),
            w: Math.abs(nx - c.ox),
            h: Math.abs(ny - c.oy),
          });
        }}
        onDragEnd={(e) => {
          const draft = resizeDraft;
          setResizeDraft(null);
          if (draft) {
            e.target.position({ x: c.cx - handleHalf, y: c.cy - handleHalf });
            commit(
              'Resize room',
              updateRoom(doc, room.id, { x: draft.x, y: draft.y, w: draft.w, h: draft.h }),
            );
          }
        }}
      />
    ));
  };

  const renderWallEndHandles = (wall: Wall) => {
    const w = wallEndDraft?.id === wall.id ? wallEndDraft : wall;
    const ends: { key: 'a' | 'b'; point: Point; other: Point }[] = [
      { key: 'a', point: w.a, other: w.b },
      { key: 'b', point: w.b, other: w.a },
    ];
    return ends.map(({ key, point, other }) => (
      <Circle
        key={`wall-handle-${key}`}
        x={point.x}
        y={point.y}
        radius={handleHalf}
        fill="#FFFFFF"
        stroke={ACTION}
        strokeWidth={2 / scale}
        draggable
        onDragMove={(e) => {
          const raw = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndFree(raw, other);
          if (distance(snapped, other) < 100) return; // refuse to collapse the wall to near-zero length
          e.target.position(snapped);
          setWallEndDraft({
            id: wall.id,
            a: key === 'a' ? snapped : wall.a,
            b: key === 'b' ? snapped : wall.b,
          });
        }}
        onDragEnd={() => {
          const draft = wallEndDraft;
          setWallEndDraft(null);
          if (draft && draft.id === wall.id) {
            commit('Reshape wall', updateWall(doc, wall.id, key === 'a' ? { a: draft.a } : { b: draft.b }));
          }
        }}
      />
    ));
  };

  const rectDraftRect = rectDraft
    ? {
        x: Math.min(rectDraft.a.x, rectDraft.b.x),
        y: Math.min(rectDraft.a.y, rectDraft.b.y),
        w: Math.abs(rectDraft.b.x - rectDraft.a.x),
        h: Math.abs(rectDraft.b.y - rectDraft.a.y),
      }
    : null;

  /* Ghost preview for door/window placement */
  const openingGhost = (() => {
    if ((tool !== 'door' && tool !== 'window') || !openingHover) return null;
    const width = tool === 'door' ? DEFAULT_DOOR_WIDTH_MM : DEFAULT_WINDOW_WIDTH_MM;
    const temp: Opening = {
      id: 'ghost',
      wallId: openingHover.wall.id,
      kind: tool,
      offsetMm: clampOpeningOffset(openingHover.wall, openingHover.offsetMm, width),
      widthMm: width,
      hinge: 'left',
    };
    const { start, end } = openingJambs(openingHover.wall, temp);
    return { start, end, thickness: openingHover.wall.thickness };
  })();

  const zonesPresent: RoomType[] = ROOM_TYPES.filter((t) => doc.rooms.some((r) => r.type === t));

  /* Right-click context menu actions. The [tool, doc] effect above closes
     the menu automatically once any of these commits, so none of them need
     to clear contextMenu themselves. */
  type MenuItem = { label: string; onClick: () => void; danger?: boolean };

  const buildContextMenuItems = (menu: NonNullable<typeof contextMenu>): MenuItem[] => {
    const { ids, kind } = menu;
    const deleteLabel = ids.length > 1 ? `Delete ${ids.length} items` : 'Delete';
    const deleteItem: MenuItem = {
      label: deleteLabel,
      danger: true,
      onClick: () => commit(deleteLabel, deleteEntities(doc, ids)),
    };

    if (ids.length > 1) return [deleteItem];

    const id = ids[0];
    if (kind === 'room') {
      const room = doc.rooms.find((r) => r.id === id);
      if (!room) return [deleteItem];
      const items: MenuItem[] = [];
      if (room.type === 'Stairs') {
        items.push({
          label: 'Flip direction',
          onClick: () =>
            commit(
              'Flip stairs direction',
              updateRoom(doc, room.id, {
                stairDirection: room.stairDirection === 'reversed' ? 'forward' : 'reversed',
              }),
            ),
        });
      } else {
        items.push({
          label: 'Duplicate room',
          onClick: () => {
            const copy: RoomRect = { ...room, id: newId(), x: room.x + 300, y: room.y + 300 };
            commit('Duplicate room', addRoom(doc, copy));
            select(copy.id);
          },
        });
      }
      items.push(deleteItem);
      return items;
    }
    if (kind === 'symbol') {
      const sym = doc.symbols.find((s) => s.id === id);
      if (!sym) return [deleteItem];
      return [
        {
          label: 'Rotate 90°',
          onClick: () => commit('Rotate furniture', updateSymbol(doc, id, { rotationDeg: (sym.rotationDeg + 90) % 360 })),
        },
        {
          label: 'Mirror',
          onClick: () => commit('Mirror furniture', updateSymbol(doc, id, { mirrored: !sym.mirrored })),
        },
        {
          label: 'Duplicate',
          onClick: () => {
            const copy: SymbolInstance = { ...sym, id: newId(), x: sym.x + 300, y: sym.y + 300 };
            commit('Duplicate furniture', addSymbol(doc, copy));
            select(copy.id);
          },
        },
        deleteItem,
      ];
    }
    if (kind === 'opening') {
      const opening = doc.openings.find((o) => o.id === id);
      if (!opening) return [deleteItem];
      const items: MenuItem[] = [];
      if (opening.kind === 'door') {
        items.push({
          label: 'Flip hinge side',
          onClick: () =>
            commit('Flip hinge', updateOpening(doc, id, { hinge: opening.hinge === 'left' ? 'right' : 'left' })),
        });
        items.push({
          label: 'Flip swing side',
          onClick: () =>
            commit(
              'Flip door swing side',
              updateOpening(doc, id, { swingSide: opening.swingSide === 'b' ? 'a' : 'b' }),
            ),
        });
      }
      items.push(deleteItem);
      return items;
    }
    if (kind === 'label') {
      const label = doc.labels.find((l) => l.id === id);
      if (!label) return [deleteItem];
      return [
        {
          label: 'Duplicate',
          onClick: () => {
            const copy = { ...label, id: newId(), x: label.x + 300, y: label.y + 300 };
            commit('Duplicate label', addLabel(doc, copy));
            select(copy.id);
          },
        },
        deleteItem,
      ];
    }
    // wall
    return [deleteItem];
  };

  const gridBackgroundImage =
    gridStyle === 'dots'
      ? 'radial-gradient(#B7C4BE 1.5px, transparent 1.5px)'
      : gridStyle === 'lines'
        ? 'linear-gradient(#E3EBE8 1px, transparent 1px), linear-gradient(90deg, #E3EBE8 1px, transparent 1px)'
        : 'none';

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none',
        overscrollBehavior: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        background: '#FBFDFC',
        backgroundImage: gridBackgroundImage,
        backgroundSize: `${DISPLAY_GRID_MM * scale}px ${DISPLAY_GRID_MM * scale}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor:
          tool === 'pan'
            ? panDrag.current
              ? 'grabbing'
              : 'grab'
            : tool === 'select'
              ? spacePressed
                ? panDrag.current
                  ? 'grabbing'
                  : 'grab'
                : 'default'
              : 'crosshair',
      }}
    >
      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        scaleX={scale}
        scaleY={scale}
        x={pan.x}
        y={pan.y}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={pointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          // A wall chain, room drag, or any other draft in progress takes
          // priority — right-click just cancels it, matching the prior
          // behaviour, rather than also popping up a menu.
          if (wallStart || rectDraft || resizeDraft || marqueeDraft || openingDraft || tool !== 'select') {
            endWallChain();
            setContextMenu(null);
            return;
          }
          const screen = stageRef.current?.getPointerPosition();
          const raw = pointerWorld();
          if (!screen || !raw) return;
          const hit = pickEntityAt(raw);
          if (!hit) {
            setContextMenu(null);
            return;
          }
          const ids = selectedIds.includes(hit.id) && selectedIds.length > 1 ? selectedIds : [hit.id];
          if (ids.length === 1) select(hit.id);
          setContextMenu({ x: screen.x, y: screen.y, ids, kind: hit.kind });
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <Layer>
          {/* Photo underlay for tracing (below everything) */}
          {underlayImg && doc.underlay && (
            <KonvaImage
              image={underlayImg}
              x={doc.underlay.xMm}
              y={doc.underlay.yMm}
              width={doc.underlay.widthMm}
              height={doc.underlay.widthMm * (underlayImg.naturalHeight / underlayImg.naturalWidth)}
              opacity={doc.underlay.opacity}
              draggable={tool === 'select' && !doc.underlay.locked}
              listening={tool === 'select' && !doc.underlay.locked}
              onDragEnd={(e) => {
                if (!doc.underlay) return;
                commit('Move underlay', {
                  ...doc,
                  underlay: { ...doc.underlay, xMm: e.target.x(), yMm: e.target.y() },
                });
              }}
            />
          )}

          {/* Rooms (incl. stairs), largest-area first so a smaller room
              nested/overlapping inside a bigger one (e.g. a stairs flight
              inside a hallway) always paints on top of it — otherwise the
              bigger room's own fill and label could end up drawn last and
              bleed over the smaller one. Matches pickRoomAt's same
              smallest-area-wins rule for clicks, so what's on top visually
              is also what you actually select. */}
          {[...doc.rooms].sort((a, b) => b.w * b.h - a.w * a.h).map((room) => {
            const r = resizeDraft?.id === room.id ? resizeDraft : room;
            const isSel = selectedIds.includes(room.id);
            const stairs = room.type === 'Stairs';
            const zone = planMode === 'presentation' ? ROOM_ZONE_COLORS[room.type] : null;
            return (
              <Group
                key={room.id}
                x={r.x}
                y={r.y}
                draggable={tool === 'select' && !resizeDraft}
                onClick={(e) => {
                  if (tool !== 'select') return;
                  const p = pointerWorld();
                  const id = (p ? pickRoomAt(p) : undefined)?.id ?? room.id;
                  const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
                  if (additive) toggleSelect(id, true);
                  else select(id);
                }}
                onTap={() => {
                  if (tool !== 'select') return;
                  const p = pointerWorld();
                  select((p ? pickRoomAt(p) : undefined)?.id ?? room.id);
                }}
                onDragStart={() => {
                  if (selectedIds.length > 1 && selectedIds.includes(room.id)) {
                    setGroupDragOrigin({ x: room.x, y: room.y });
                  } else {
                    select(room.id);
                  }
                }}
                onDragEnd={(e) => {
                  const snapped = snapFree({ x: e.target.x(), y: e.target.y() });
                  e.target.position(snapped);
                  if (groupDragOrigin && selectedIds.length > 1 && selectedIds.includes(room.id)) {
                    const dx = snapped.x - groupDragOrigin.x;
                    const dy = snapped.y - groupDragOrigin.y;
                    setGroupDragOrigin(null);
                    commitGroupMove(dx, dy);
                    return;
                  }
                  // Dragging a room takes its fabric with it — bounding
                  // walls and anything sitting inside (stairs, furniture,
                  // text) — so "move the room" moves the whole room, not
                  // just the floor rect sliding out from under its walls.
                  // Walls shared with a neighbouring room ride along too
                  // (they ARE this room's wall); undo reverses the lot.
                  const dx = snapped.x - room.x;
                  const dy = snapped.y - room.y;
                  if (dx === 0 && dy === 0) return;
                  const margin = 200;
                  const x0 = room.x - margin;
                  const y0 = room.y - margin;
                  const x1 = room.x + room.w + margin;
                  const y1 = room.y + room.h + margin;
                  const inside = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
                  let next = updateRoom(doc, room.id, { x: snapped.x, y: snapped.y });
                  for (const w of doc.walls) {
                    if (inside(w.a) && inside(w.b)) {
                      next = updateWall(next, w.id, {
                        a: { x: w.a.x + dx, y: w.a.y + dy },
                        b: { x: w.b.x + dx, y: w.b.y + dy },
                      });
                    }
                  }
                  for (const r2 of doc.rooms) {
                    if (r2.id === room.id) continue;
                    if (r2.x >= x0 && r2.y >= y0 && r2.x + r2.w <= x1 && r2.y + r2.h <= y1) {
                      next = updateRoom(next, r2.id, { x: r2.x + dx, y: r2.y + dy });
                    }
                  }
                  for (const s of doc.symbols) {
                    if (inside({ x: s.x + s.w / 2, y: s.y + s.h / 2 })) {
                      next = updateSymbol(next, s.id, { x: s.x + dx, y: s.y + dy });
                    }
                  }
                  for (const l of doc.labels) {
                    if (inside({ x: l.x, y: l.y })) {
                      next = updateLabel(next, l.id, { x: l.x + dx, y: l.y + dy });
                    }
                  }
                  commit('Move room', next);
                }}
              >
                <Rect
                  width={r.w}
                  height={r.h}
                  fill={isSel ? SELECT_FILL : (zone?.fill ?? '#FFFFFF')}
                  stroke={isSel ? ACTION : (zone?.edge ?? ROOM_EDGE)}
                  strokeWidth={isSel ? 34 : 18}
                  dash={isSel ? [110, 75] : undefined}
                />
                {stairs ? (
                  <StairsTreads room={r} />
                ) : (
                  /* Name + area/height as one draggable group: drag the text
                     off to a corner when furniture sits mid-room. The halo
                     stroke keeps it readable over anything it lands on.
                     CRITICAL: the group only listens when its room is
                     already selected — an always-active label would put an
                     invisible room-wide band across every room's middle
                     that steals clicks and drags meant for the room (and a
                     label dragged elsewhere would swallow clicks wherever
                     it landed). Flow: first click selects the room (label
                     is transparent to it), then the label can be dragged. */
                  <Group
                    x={r.labelOffset?.x ?? 0}
                    y={r.labelOffset?.y ?? 0}
                    listening={isSel && tool === 'select'}
                    draggable={isSel && tool === 'select'}
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      commit(
                        'Move room label',
                        updateRoom(doc, room.id, {
                          labelOffset: { x: e.target.x(), y: e.target.y() },
                        }),
                      );
                    }}
                  >
                    <Text
                      text={r.name}
                      width={r.w}
                      y={r.h / 2 - 320}
                      align="center"
                      fontSize={260}
                      fontFamily={SANS}
                      fontStyle="600"
                      fill={INK}
                      stroke="#FFFFFF"
                      strokeWidth={30}
                      fillAfterStrokeEnabled
                    />
                    {showRoomLabels && (
                      <Text
                        text={`${formatAreaM2(roomAreaM2(r))} · ${r.ceilingHeightM.toFixed(2)}m`}
                        width={r.w}
                        y={r.h / 2 + 60}
                        align="center"
                        fontSize={185}
                        fontFamily={MONO}
                        fill={FAINT}
                        stroke="#FFFFFF"
                        strokeWidth={26}
                        fillAfterStrokeEnabled
                      />
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* Walls (cut around openings) */}
          {doc.walls.map((wOriginal) => {
            const w = wallEndDraft?.id === wOriginal.id ? { ...wOriginal, a: wallEndDraft.a, b: wallEndDraft.b } : wOriginal;
            const isSel = selectedIds.includes(w.id);
            const openings = doc.openings.map((o) =>
              openingDraft && o.id === openingDraft.id ? { ...o, offsetMm: openingDraft.offsetMm } : o,
            );
            // Walls only move as a whole via group-drag (grabbing this wall
            // while it's part of a multi-selection) — a lone selected wall
            // is reshaped via its endpoint handles instead, not dragged
            // bodily. Only the first segment is made draggable so a wall
            // split by an opening doesn't visually tear apart mid-drag.
            const isGroupDraggable = tool === 'select' && selectedIds.length > 1 && selectedIds.includes(w.id);
            return wallSegments(w, openings).map((seg, i) => (
              <Line
                key={`${w.id}-${i}`}
                points={[seg.a.x, seg.a.y, seg.b.x, seg.b.y]}
                stroke={isSel ? ACTION : WALL}
                strokeWidth={w.thickness}
                lineCap="square"
                // Keep the clickable band a constant width on screen — a
                // fixed mm value shrinks to just a few px once the user
                // zooms out to see the whole plan, which is exactly when
                // thin internal walls (sandwiched between two much larger,
                // always-clickable room rects) become unselectable.
                hitStrokeWidth={Math.max(w.thickness, 24 / scale)}
                draggable={i === 0 && isGroupDraggable}
                onClick={(e) => {
                  if (tool !== 'select') return;
                  const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
                  if (additive) toggleSelect(w.id, true);
                  else select(w.id);
                }}
                onTap={() => tool === 'select' && select(w.id)}
                onDragStart={() => setGroupDragOrigin(w.a)}
                onDragEnd={(e) => {
                  if (!groupDragOrigin) return;
                  const snappedA = snapFree({ x: w.a.x + e.target.x(), y: w.a.y + e.target.y() });
                  e.target.position({ x: 0, y: 0 });
                  const dx = snappedA.x - w.a.x;
                  const dy = snappedA.y - w.a.y;
                  setGroupDragOrigin(null);
                  commitGroupMove(dx, dy);
                }}
              />
            ));
          })}

          {/* Persistent wall-length dimensions ("Tweaks" > Show dimensions),
              CAD-style: centred on the wall's midpoint, offset perpendicular
              so it hovers beside the stroke, rotated parallel to the wall
              (flipped whenever it would read upside-down), and legible via a
              canvas-coloured halo stroke instead of a white background box
              that used to sit over the wall joints. */}
          {showDimensions &&
            doc.walls.map((w) => {
              const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
              const n = wallNormal(w);
              const offset = w.thickness / 2 + 320;
              let angle = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
              if (angle > 90) angle -= 180;
              else if (angle <= -90) angle += 180;
              return (
                <Text
                  key={`dim-${w.id}`}
                  x={mid.x + n.x * offset}
                  y={mid.y + n.y * offset}
                  rotation={angle}
                  text={formatMmAsM(wallLengthMm(w))}
                  width={1600}
                  align="center"
                  offsetX={800}
                  offsetY={80}
                  fontSize={155}
                  fontFamily={MONO}
                  fill={INK}
                  stroke="#FBFDFC"
                  strokeWidth={34}
                  fillAfterStrokeEnabled
                  listening={false}
                />
              );
            })}

          {/* Overall plan-extent dimensions — the same total width/height
              lines the exported sheet shows, kept live on the canvas so the
              edit view is WYSIWYG with the export. Dashed + lighter so they
              read as secondary to the per-wall labels. */}
          {showDimensions && doc.walls.length > 0 && (() => {
            const minX = Math.min(...doc.walls.flatMap((w) => [w.a.x, w.b.x]));
            const maxX = Math.max(...doc.walls.flatMap((w) => [w.a.x, w.b.x]));
            const minY = Math.min(...doc.walls.flatMap((w) => [w.a.y, w.b.y]));
            const maxY = Math.max(...doc.walls.flatMap((w) => [w.a.y, w.b.y]));
            if (maxX - minX < 1 || maxY - minY < 1) return null;
            const gap = 700;
            const topY = minY - gap;
            const leftX = minX - gap;
            return (
              <Group listening={false}>
                <Line points={[minX, topY, maxX, topY]} stroke={DIM_LINE} strokeWidth={16} dash={[160, 110]} />
                <Line points={[minX, topY - 110, minX, topY + 110]} stroke={DIM_LINE} strokeWidth={16} />
                <Line points={[maxX, topY - 110, maxX, topY + 110]} stroke={DIM_LINE} strokeWidth={16} />
                <Text
                  x={(minX + maxX) / 2}
                  y={topY - 130}
                  text={formatMmAsM(maxX - minX)}
                  width={1600}
                  align="center"
                  offsetX={800}
                  offsetY={155}
                  fontSize={165}
                  fontFamily={MONO}
                  fill={DIM_LINE}
                  stroke="#FBFDFC"
                  strokeWidth={34}
                  fillAfterStrokeEnabled
                />
                <Line points={[leftX, minY, leftX, maxY]} stroke={DIM_LINE} strokeWidth={16} dash={[160, 110]} />
                <Line points={[leftX - 110, minY, leftX + 110, minY]} stroke={DIM_LINE} strokeWidth={16} />
                <Line points={[leftX - 110, maxY, leftX + 110, maxY]} stroke={DIM_LINE} strokeWidth={16} />
                <Text
                  x={leftX - 130}
                  y={(minY + maxY) / 2}
                  rotation={-90}
                  text={formatMmAsM(maxY - minY)}
                  width={1600}
                  align="center"
                  offsetX={800}
                  offsetY={155}
                  fontSize={165}
                  fontFamily={MONO}
                  fill={DIM_LINE}
                  stroke="#FBFDFC"
                  strokeWidth={34}
                  fillAfterStrokeEnabled
                />
              </Group>
            );
          })()}

          {/* Openings */}
          {doc.openings.map((o) => {
            const wall = findWall(doc, o.wallId);
            if (!wall) return null;
            const effective = openingDraft && o.id === openingDraft.id ? { ...o, offsetMm: openingDraft.offsetMm } : o;
            return (
              <OpeningShape
                key={o.id}
                wall={wall}
                opening={effective}
                selected={selectedIds.includes(o.id)}
                onSelect={(additive) => {
                  if (tool !== 'select') return;
                  if (additive) toggleSelect(o.id, true);
                  else select(o.id);
                }}
                onGrab={() => {
                  if (tool !== 'select') return;
                  select(o.id);
                  openingDrag.current = { id: o.id, wallId: o.wallId };
                }}
              />
            );
          })}

          {/* Furniture symbols */}
          {showFurniture && doc.symbols.map((sym) => (
            <SymbolNode
              key={sym.id}
              sym={sym}
              selected={selectedIds.includes(sym.id)}
              isMultiSelected={selectedIds.length > 1 && selectedIds.includes(sym.id)}
              draggable={tool === 'select'}
              onSelect={(additive) => {
                if (tool !== 'select') return;
                if (additive) toggleSelect(sym.id, true);
                else select(sym.id);
              }}
              onMove={(x, y) => {
                const centre = { x: x + sym.w / 2, y: y + sym.h / 2 };
                const aligned = alignToNearbyWall(centre, sym.w, sym.h);
                if (aligned) {
                  commit(
                    'Move symbol',
                    updateSymbol(doc, sym.id, { x: aligned.x, y: aligned.y, rotationDeg: aligned.rotationDeg }),
                  );
                } else {
                  const snapped = snapFree({ x, y });
                  commit('Move symbol', updateSymbol(doc, sym.id, { x: snapped.x, y: snapped.y }));
                }
              }}
              onGroupDragStart={(x, y) => setGroupDragOrigin({ x, y })}
              onGroupDragEnd={(x, y) => {
                if (!groupDragOrigin) return;
                const snapped = snapFree({ x, y });
                const dx = snapped.x - groupDragOrigin.x;
                const dy = snapped.y - groupDragOrigin.y;
                setGroupDragOrigin(null);
                commitGroupMove(dx, dy);
              }}
            />
          ))}

          {/* Text labels */}
          {doc.labels.map((label) => (
            <Text
              key={label.id}
              x={label.x}
              y={label.y}
              text={label.text}
              fontSize={220}
              fontFamily={SANS}
              fontStyle="600"
              fill={selectedIds.includes(label.id) ? ACTION : INK}
              align="center"
              offsetX={label.text.length * 55}
              draggable={tool === 'select'}
              onClick={(e) => {
                if (tool !== 'select') return;
                const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
                if (additive) toggleSelect(label.id, true);
                else select(label.id);
              }}
              onTap={() => tool === 'select' && select(label.id)}
              onDragStart={() => {
                if (selectedIds.length > 1 && selectedIds.includes(label.id)) {
                  setGroupDragOrigin({ x: label.x, y: label.y });
                } else {
                  select(label.id);
                }
              }}
              onDragEnd={(e) => {
                if (groupDragOrigin && selectedIds.length > 1 && selectedIds.includes(label.id)) {
                  const dx = e.target.x() - groupDragOrigin.x;
                  const dy = e.target.y() - groupDragOrigin.y;
                  setGroupDragOrigin(null);
                  commitGroupMove(dx, dy);
                  return;
                }
                commit('Move label', updateLabel(doc, label.id, { x: e.target.x(), y: e.target.y() }));
              }}
            />
          ))}

          {/* Measure overlay */}
          {tool === 'measure' && measureA && hoverPt && (
            <>
              <Line
                points={[measureA.x, measureA.y, hoverPt.x, hoverPt.y]}
                stroke={ACTION}
                strokeWidth={25}
                dash={[140, 90]}
                listening={false}
              />
              <Circle x={measureA.x} y={measureA.y} radius={70} fill={ACTION} listening={false} />
              <Circle x={hoverPt.x} y={hoverPt.y} radius={70} fill={ACTION} listening={false} />
              <Label
                x={(measureA.x + hoverPt.x) / 2}
                y={(measureA.y + hoverPt.y) / 2 - 380}
                listening={false}
              >
                <Tag fill="#FFFFFF" opacity={0.94} cornerRadius={90} />
                <Text
                  text={formatMmAsM(distance(measureA, hoverPt))}
                  fontSize={210}
                  fontFamily={MONO}
                  fill={ACTION}
                  padding={80}
                />
              </Label>
            </>
          )}

          {/* Marquee (rubber-band) select */}
          {marqueeDraft && (
            <Rect
              x={Math.min(marqueeDraft.a.x, marqueeDraft.b.x)}
              y={Math.min(marqueeDraft.a.y, marqueeDraft.b.y)}
              width={Math.abs(marqueeDraft.b.x - marqueeDraft.a.x)}
              height={Math.abs(marqueeDraft.b.y - marqueeDraft.a.y)}
              fill={ACTION}
              opacity={0.08}
              stroke={ACTION}
              strokeWidth={6}
              dash={[40, 30]}
              listening={false}
            />
          )}

          {/* Door/window placement ghost */}
          {openingGhost && (
            <Line
              points={[openingGhost.start.x, openingGhost.start.y, openingGhost.end.x, openingGhost.end.y]}
              stroke={ACTION}
              strokeWidth={Math.max(openingGhost.thickness * 1.6, 220)}
              opacity={0.4}
              lineCap="butt"
              listening={false}
            />
          )}

          {/* Wall draft preview */}
          {tool === 'wall' && hoverPt && !wallStart && (
            <Circle x={hoverPt.x} y={hoverPt.y} radius={90} stroke={ACTION} strokeWidth={30} listening={false} />
          )}
          {tool === 'wall' && wallStart && hoverPt && !keyedDirection && (
            <>
              <Line
                points={[wallStart.x, wallStart.y, hoverPt.x, hoverPt.y]}
                stroke={ACTION}
                strokeWidth={drawThickness}
                opacity={0.55}
                lineCap="square"
                listening={false}
              />
              <Circle x={wallStart.x} y={wallStart.y} radius={80} fill={ACTION} listening={false} />
              <Label
                x={(wallStart.x + hoverPt.x) / 2}
                y={(wallStart.y + hoverPt.y) / 2 - 380}
                listening={false}
              >
                <Tag fill="#FFFFFF" opacity={0.94} cornerRadius={90} />
                <Text
                  text={`${formatMmAsM(distance(wallStart, hoverPt))} · ${drawExternal ? 'external' : 'internal'} — X flips`}
                  fontSize={210}
                  fontFamily={MONO}
                  fill={ACTION}
                  padding={80}
                />
              </Label>
            </>
          )}

          {/* Laser-measure keyboard entry preview: an arrow key locked a
              direction, digits are being typed for the exact length. */}
          {tool === 'wall' &&
            wallStart &&
            keyedDirection &&
            (() => {
              const typedMm = parseLengthToMm(keyedLength);
              const previewMm = typedMm ?? 1000;
              const endpoint = {
                x: wallStart.x + keyedDirection.x * previewMm,
                y: wallStart.y + keyedDirection.y * previewMm,
              };
              return (
                <>
                  <Line
                    points={[wallStart.x, wallStart.y, endpoint.x, endpoint.y]}
                    stroke={ACTION}
                    strokeWidth={drawThickness}
                    opacity={typedMm ? 0.55 : 0.3}
                    dash={typedMm ? undefined : [60, 60]}
                    lineCap="square"
                    listening={false}
                  />
                  <Circle x={wallStart.x} y={wallStart.y} radius={80} fill={ACTION} listening={false} />
                  <Label x={endpoint.x} y={endpoint.y - 380} listening={false}>
                    <Tag fill={ACTION} opacity={0.96} cornerRadius={90} />
                    <Text
                      text={keyedLength ? `${keyedLength} m ↵` : 'Type a length…'}
                      fontSize={210}
                      fontFamily={MONO}
                      fill="#FFFFFF"
                      padding={80}
                    />
                  </Label>
                </>
              );
            })()}

          {/* Room/stairs draft preview */}
          {rectDraftRect && rectDraftRect.w > 0 && rectDraftRect.h > 0 && (
            <>
              <Rect
                x={rectDraftRect.x}
                y={rectDraftRect.y}
                width={rectDraftRect.w}
                height={rectDraftRect.h}
                fill={SELECT_FILL}
                stroke={ACTION}
                strokeWidth={26}
                dash={[120, 80]}
                listening={false}
              />
              <Label
                x={rectDraftRect.x + rectDraftRect.w / 2}
                y={rectDraftRect.y - 380}
                listening={false}
              >
                <Tag fill="#FFFFFF" opacity={0.94} cornerRadius={90} />
                <Text
                  text={formatDims(rectDraftRect.w, rectDraftRect.h)}
                  fontSize={210}
                  fontFamily={MONO}
                  fill={ACTION}
                  padding={80}
                />
              </Label>
            </>
          )}

          {/* Resize handles for the selected room */}
          {selectedRoom && tool === 'select' && renderResizeHandles(selectedRoom)}

          {/* Endpoint drag handles for the selected wall */}
          {selectedWall && tool === 'select' && renderWallEndHandles(selectedWall)}
        </Layer>
      </Stage>

      <div
        style={{
          position: 'absolute',
          right: 16,
          top: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        {/* Live North indicator — the "PLAN ORIENTATION" panel only shows a
            static icon off to the side; this keeps orientation visible right
            on the plan itself while drawing, not just after export. Pinned
            top-right (EditorPage's "Welcome to the editor" card is shifted
            down to clear it — see EDITOR_WELCOME_SEEN_KEY usage there). */}
        <div
          title={`North is ${doc.northAngleDeg ?? 0}°`}
          style={{
            display: 'flex',
            height: 40,
            width: 40,
            flex: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)',
            border: `1px solid ${ROOM_EDGE}`,
            boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
          }}
        >
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            style={{ transform: `rotate(${doc.northAngleDeg ?? 0}deg)` }}
          >
            <polygon points="12,2 16,13 12,10 8,13" fill={INK} />
            <line x1="12" y1="13" x2="12" y2="22" stroke={FAINT} strokeWidth={1.6} />
          </svg>
        </div>

        {planMode === 'presentation' && zonesPresent.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              maxWidth: 320,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.92)',
              border: `1px solid ${ROOM_EDGE}`,
              boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
              fontFamily: SANS,
            }}
          >
            {zonesPresent.map((type) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: ROOM_ZONE_COLORS[type].fill,
                    border: `1.5px solid ${ROOM_ZONE_COLORS[type].edge}`,
                    flex: 'none',
                  }}
                />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: INK }}>{type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu &&
        (() => {
          const items = buildContextMenuItems(contextMenu);
          const menuWidth = 190;
          const menuHeight = items.length * 32 + 12;
          const left = Math.min(contextMenu.x, Math.max(8, viewport.width - menuWidth - 8));
          const top = Math.min(contextMenu.y, Math.max(8, viewport.height - menuHeight - 8));
          return (
            <>
              <div
                style={{ position: 'absolute', inset: 0, zIndex: 40 }}
                onClick={() => setContextMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu(null);
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left,
                  top,
                  zIndex: 50,
                  width: menuWidth,
                  borderRadius: 10,
                  background: '#FFFFFF',
                  border: `1px solid ${ROOM_EDGE}`,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.16)',
                  padding: 6,
                  fontFamily: SANS,
                }}
              >
                {items.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={item.onClick}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: item.danger ? '#B3432B' : INK,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 7,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#F1F5F3';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          );
        })()}
    </div>
  );
}
