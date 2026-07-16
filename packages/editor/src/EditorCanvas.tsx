import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  autoClassifyWallThickness,
  clampOpeningOffset,
  DEFAULT_CEILING_HEIGHT_M,
  DEFAULT_DOOR_WIDTH_MM,
  DEFAULT_WALL_THICKNESS_MM,
  detectRooms,
  EXTERNAL_WALL_THICKNESS_MM,
  DEFAULT_WINDOW_WIDTH_MM,
  findRoomOverlaps,
  deleteEntities,
  distance,
  distanceToWall,
  doorSwingGeometry,
  findWall,
  docBounds,
  formatArea,
  formatDims,
  formatMmAsM,
  nearestOffsetOnWall,
  nearestWall,
  newId,
  pointInPolygon,
  openingJambs,
  parseLengthToMm,
  pointAlongWall,
  differenceRectilinear,
  openingRenderCtx,
  openingShapes,
  ringBounds,
  ringsOverlap,
  roomAreaM2,
  roomLabelShrink,
  roomTypeLabel,
  roomPolygon,
  smartRoomLabelOffset,
  stairShapes,
  wallComponents,
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
  wallBodyQuads,
  wallLengthMm,
  wallsForRoom,
  wallsForPolygon,
  wallNormal,
  type FloorDoc,
  type Opening,
  type Shape as CoreShape,
  type Point,
  type RoomRect,
  type RoomType,
  type SymbolInstance,
  type TextLabel,
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
const WARN = '#D08A2C';
const SANS = "'Instrument Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const DIM_LINE = '#7C9A90';

const PAN_TIP_SEEN_KEY = 'floorplan:seenPanTip';
const ZERO_POINT = { x: 0, y: 0 } as const;

/** True on touch-first devices (phones/tablets) — used to size grab
 *  handles for fingers instead of a mouse cursor. Evaluated once: a
 *  device's primary pointer doesn't change mid-session. */
const COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const isDraftingTool = (t: Tool) => t === 'room' || t === 'stairs';

/** Perpendicular distance from `p` to segment [a,b], mm. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Signed shortest angular difference b-a, degrees in (-180, 180]. */
function angleDeltaDeg(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Rotate vector `v` by `deg` degrees about the origin. */
function rotateVec(v: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Smallest furniture footprint a resize handle can shrink to, mm. */
const MIN_SYMBOL_MM = 150;
// World-space gap between a furniture symbol's top edge and its rotate handle.
const ROTATE_HANDLE_OFF_MM = 420;

/** Fixed ray (room-label-local mm at scale 1) from a label's centre to its
 *  font-size handle; the handle sits at centre + BASE * scale. */
const LABEL_HANDLE_BASE = { x: 1150, y: 470 };
const LABEL_HANDLE_BASE_MAG = Math.hypot(LABEL_HANDLE_BASE.x, LABEL_HANDLE_BASE.y);

/** An in-progress grab of a resize/reshape handle. Handles are picked and
 *  dragged geometrically (like entities), NOT via Konva hit detection —
 *  Konva's pixel hit canvas is broken under Brave's farbling, which made
 *  handle grabs land on the entity underneath instead ("resizing just
 *  selects/moves it" / "resizing a room selects the wall"). */
type HandleDrag =
  | { kind: 'room-resize'; room: RoomRect; ox: number; oy: number }
  | { kind: 'wall-end'; wall: Wall; end: 'a' | 'b' }
  | { kind: 'symbol-resize'; symbol: SymbolInstance; sx: 1 | -1; sy: 1 | -1; opp: Point }
  | { kind: 'symbol-rotate'; symbol: SymbolInstance }
  | { kind: 'label-scale'; entity: 'room' | 'text'; id: string; center: Point }
  | { kind: 'room-label-move'; room: RoomRect; startWorld: Point; origin: Point };

/** Overlap area of two AABBs {x0,y0,x1,y1}. */
/** Furniture symbol rendered from its unit-box primitives inside a rotatable group. */
function SymbolNode({ sym, selected }: { sym: SymbolInstance; selected: boolean }) {
  const def = SYMBOL_DEFS[sym.kind];
  const sx = sym.w / 100;
  const sy = sym.h / 100;
  const mirrored = sym.mirrored ?? false;
  const mx = (ux: number) => (mirrored ? 100 - ux : ux);
  const stroke = selected ? ACTION : WALL_LIGHT;
  return (
    // Non-interactive: selection + drag are handled by the Stage-level
    // geometric pointer pipeline, not Konva hit detection.
    <Group
      x={sym.x + sym.w / 2}
      y={sym.y + sym.h / 2}
      offsetX={sym.w / 2}
      offsetY={sym.h / 2}
      rotation={sym.rotationDeg}
      listening={false}
    >
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

/** Render core display-list shapes as Konva nodes — lets the canvas reuse
 *  the exact same opening/stairs graphics the export backends draw, so the
 *  two can never drift. `recolor` maps stroke colours (selection highlight)
 *  while leaving fills (thresholds) untouched. */
function CoreShapes({ shapes, recolor }: { shapes: CoreShape[]; recolor?: (c: string) => string }) {
  const rc = recolor ?? ((c: string) => c);
  return (
    <>
      {shapes.map((sh, i) => {
        if (sh.kind === 'line') {
          return (
            <Line
              key={i}
              points={[sh.x1, sh.y1, sh.x2, sh.y2]}
              stroke={rc(sh.stroke)}
              strokeWidth={sh.width}
              dash={sh.dash}
              listening={false}
            />
          );
        }
        if (sh.kind === 'arc') {
          const angle = Math.abs(sh.endDeg - sh.startDeg);
          return (
            <Arc
              key={i}
              x={sh.cx}
              y={sh.cy}
              innerRadius={sh.r}
              outerRadius={sh.r}
              angle={angle}
              rotation={Math.min(sh.startDeg, sh.endDeg)}
              stroke={rc(sh.stroke)}
              strokeWidth={sh.width}
              listening={false}
            />
          );
        }
        if (sh.kind === 'polyline') {
          return (
            <Line
              key={i}
              points={sh.points.flatMap((p) => [p.x, p.y])}
              closed={sh.closed}
              fill={sh.fill}
              stroke={sh.fill && sh.stroke === sh.fill ? sh.stroke : rc(sh.stroke)}
              strokeWidth={sh.width}
              lineJoin="round"
              listening={false}
            />
          );
        }
        if (sh.kind === 'rect') {
          return (
            <Rect
              key={i}
              x={sh.x}
              y={sh.y}
              width={sh.w}
              height={sh.h}
              fill={sh.fill}
              stroke={sh.stroke ? rc(sh.stroke) : undefined}
              strokeWidth={sh.strokeWidth}
              listening={false}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function StairsTreads({ room }: { room: RoomRect }) {
  // Rendered inside the room's Group (origin at room.x/y), so generate the
  // core shapes with a zero-origin copy. Same graphics as the export.
  return <CoreShapes shapes={stairShapes({ ...room, x: 0, y: 0 })} />;
}

function OpeningShape({
  wall,
  opening,
  selected,
  doc,
  planMode,
}: {
  wall: Wall;
  opening: Opening;
  selected: boolean;
  doc: FloorDoc;
  planMode: 'technical' | 'presentation';
}) {
  // Exactly the shapes the export draws (styles, thresholds, projections),
  // recoloured to the selection accent when picked. Openings are selected
  // and dragged via the Stage-level geometric pipeline — nothing listens.
  const shapes = openingShapes(wall, opening, openingRenderCtx(doc, wall, opening, planMode));
  return <CoreShapes shapes={shapes} recolor={selected ? () => ACTION : undefined} />;
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
  const autoRoomWalls = useEditorStore((s) => s.autoRoomWalls);
  const areaUnits = useEditorStore((s) => s.areaUnits);
  const requestFocusName = useEditorStore((s) => s.requestFocusName);
  const autoWallThickness = useEditorStore((s) => s.autoWallThickness);
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
  // Vertices of a shaped (L/T/U/polygon) room being clicked out with the Room
  // tool; null when not in polygon mode. The down-screen point distinguishes a
  // click (place a vertex) from a drag (draw a quick rectangle).
  const [polyDraft, setPolyDraft] = useState<Point[] | null>(null);
  const roomDownScreen = useRef<Point | null>(null);
  const [resizeDraft, setResizeDraft] = useState<RoomRect | null>(null);
  const [symbolResizeDraft, setSymbolResizeDraft] = useState<SymbolInstance | null>(null);
  // Live rotation preview while the furniture rotate handle is dragged.
  const [symbolRotateDraft, setSymbolRotateDraft] = useState<{ id: string; deg: number } | null>(null);
  const [labelScaleDraft, setLabelScaleDraft] = useState<{ id: string; scale: number } | null>(null);
  // Live preview while a room's name/area label block is being dragged.
  const [labelMoveDraft, setLabelMoveDraft] = useState<{ id: string; off: Point } | null>(null);
  const [wallEndDraft, setWallEndDraft] = useState<{ id: string; a: Point; b: Point } | null>(null);
  const [openingHover, setOpeningHover] = useState<{ wall: Wall; offsetMm: number } | null>(null);
  const [openingDraft, setOpeningDraft] = useState<{ id: string; offsetMm: number } | null>(null);
  const [measureA, setMeasureA] = useState<Point | null>(null);
  const [underlayImg, setUnderlayImg] = useState<HTMLImageElement | null>(null);
  const [underlayDrag, setUnderlayDrag] = useState<Point | null>(null);
  const underlayDragRef = useRef<{ startWorld: Point; origin: Point } | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  // Geometric select + drag: all selection and dragging is driven by
  // pickEntityAt (pure math on the doc), NOT Konva's pixel-based hit canvas.
  // Konva reads the shape under the pointer from an offscreen hit canvas via
  // getImageData — which Brave's fingerprint defense ("farbling") perturbs
  // with per-pixel noise, so hits land nowhere or on the wrong shape
  // (intermittent "can't select walls / some furniture won't move"). Doing
  // the hit-test ourselves makes it identical in every browser.
  const [manualDrag, setManualDrag] = useState<{ ids: string[]; delta: Point } | null>(null);
  const manualDragRef = useRef<{ ids: string[]; startWorld: Point; single: boolean } | null>(null);
  const pointerMods = useRef({ additive: false, shift: false });
  /* Wall tool: press X mid-draw to flip the pending wall between internal
     (100mm) and external (200mm) — no more drawing first and re-typing the
     thickness afterwards. */
  const [drawExternal, setDrawExternal] = useState(false);
  /* Wall tool: axis values the pending point is aligned with (matched to an
     existing wall corner) — rendered as dashed guide lines. */
  const [alignGuides, setAlignGuides] = useState<{ x: number | null; y: number | null } | null>(null);
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
    setAlignGuides(null);
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

  const detectPreview = useEditorStore((s) => s.detectPreview);
  // Only computed while the Detect button is hovered; pure function of doc.
  const detectPreviewRooms = useMemo(
    () => (detectPreview ? detectRooms(doc) : []),
    [detectPreview, doc],
  );

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

  /* The floor doc loads asynchronously, so the initial fit often runs against
     a still-empty doc — the fallback view then leaves the real plan half
     off-screen (worst on phones). Re-fit once when content first arrives,
     unless the user has already made an edit (never yank the view mid-draw). */
  const didContentFit = useRef(false);
  useEffect(() => {
    if (didContentFit.current || !docBounds(doc)) return;
    didContentFit.current = true;
    const st = useEditorStore.getState();
    if (!st.canUndo) st.fitToView();
  }, [doc]);

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
    setPolyDraft(null);
    roomDownScreen.current = null;
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

  // World position from raw client coordinates — unlike pointerWorld()
  // (Konva's last stage-local pointer, which goes stale the moment the
  // cursor leaves the canvas), this stays correct outside the Stage, so a
  // drag that strays past the canvas edge keeps tracking and can commit.
  const worldFromClient = useCallback(
    (client: Point): Point | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return toWorld({ x: client.x - rect.left, y: client.y - rect.top });
    },
    [toWorld],
  );

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

  // Hold Shift while drawing to lock the pending segment to 45° increments
  // (horizontal / vertical / diagonal) from the chain point — the standard
  // "draw straight" constraint. Length still snaps to the grid.
  const constrainOrthoTo = useCallback(
    (raw: Point, start: Point): Point => {
      const dx = raw.x - start.x;
      const dy = raw.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return raw;
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = snapEnabled ? Math.max(GRID_MM, Math.round(dist / GRID_MM) * GRID_MM) : dist;
      return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len };
    },
    [snapEnabled],
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

  // Generous band used when PLACING a door/window (you click near a wall
  // and it snaps on) — a wide catch radius is helpful there.
  const wallHitToleranceMm = Math.max(24 / scale, 150);
  // Tight ~12px band for SELECTING a wall/opening by click. A wide select
  // band overlaps at corners, so the perpendicular-nearest wall
  // cannibalises clicks meant for its neighbour ("some walls can't be
  // selected even clicked directly" / "selects from far away"). Floored at
  // 60mm so the full visible thickness of a 100mm wall stays grabbable even
  // at max zoom-in.
  const wallSelectToleranceMm = Math.max(12 / scale, 60);

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
        const inside =
          r.polygon && r.polygon.length >= 3
            ? pointInPolygon(p, r.polygon)
            : p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
        if (inside) {
          const area = roomAreaM2(r); // smallest-area-wins so nested rooms select
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
  // A door's clickable graphics (leaf + swing arc) reach OUT into the room,
  // far from the wall centreline — so nearestWall alone never catches a
  // click on the visible door, only on the thin gap where it meets the
  // wall. (Windows sit flush in the wall, which is why they select fine and
  // doors didn't.) Pick a door when the pointer is near its leaf line or on
  // its swing arc band. Tolerance is touch-sized in world mm.
  const pickDoorAt = useCallback(
    (p: Point): string | undefined => {
      const tol = Math.max(220, 16 / scale);
      for (let i = doc.openings.length - 1; i >= 0; i--) {
        const o = doc.openings[i];
        if (o.kind !== 'door') continue;
        const wall = doc.walls.find((w) => w.id === o.wallId);
        if (!wall) continue;
        const { hinge, tip, startDeg, delta } = doorSwingGeometry(wall, o);
        // On the leaf (hinge → tip)?
        if (distanceToSegment(p, hinge, tip) <= tol) return o.id;
        // On the swing arc band (radius ≈ widthMm, within the swept angle)?
        const r = Math.hypot(p.x - hinge.x, p.y - hinge.y);
        if (Math.abs(r - o.widthMm) <= tol) {
          const ang = (Math.atan2(p.y - hinge.y, p.x - hinge.x) * 180) / Math.PI;
          const rel = angleDeltaDeg(startDeg, ang);
          const within = delta >= 0 ? rel >= -6 && rel <= delta + 6 : rel <= 6 && rel >= delta - 6;
          if (within) return o.id;
        }
      }
      return undefined;
    },
    [doc, scale],
  );

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
      // Doors, picked by their leaf/arc graphics (see pickDoorAt) — before
      // the wall test so clicking the visible door beats the wall behind it.
      const doorId = pickDoorAt(p);
      if (doorId) return { id: doorId, kind: 'opening' };
      const hit = nearestWall(doc, p, wallSelectToleranceMm);
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
    [doc, wallSelectToleranceMm, pickDoorAt, pickRoomAt],
  );

  // Crash-proofing for drag handlers: if a geometry/commit throws mid-drag,
  // swallow it (logged), clear any in-progress interaction state, and reset
  // the dragged node to a sane position so the canvas never freezes.
  const guardDrag = useCallback((label: string, fn: () => void, node?: Konva.Node) => {
    try {
      fn();
    } catch (err) {
      // Loud on purpose: if this ever fires in the field we want it in the
      // console so a "drag did nothing" report has an actual error attached.
      console.warn('Drag aborted by guardDrag:', label, err);
      setWallEndDraft(null);
      setResizeDraft(null);
      setSymbolResizeDraft(null);
      setLabelScaleDraft(null);
      setMarqueeDraft(null);
      setManualDrag(null);
      setUnderlayDrag(null);
      manualDragRef.current = null;
      handleDragRef.current = null;
      underlayDragRef.current = null;
      openingDrag.current = null;
      panDrag.current = null;
      try {
        node?.position({ x: 0, y: 0 });
        node?.getLayer()?.batchDraw();
      } catch {
        /* node may be gone; ignore */
      }
    }
  }, []);

  // Furniture wall-alignment anchor: placing or dragging a symbol within
  // reach of a wall snaps it flush against the wall's face and rotates it
  // so its back (every symbol is authored with its back edge at local
  // y=0 — the headboard end of a bed, the backrest of a sofa, etc.) faces
  // that wall, on whichever side of the wall the point actually sits.
  const alignToNearbyWall = useCallback(
    (p: Point, w: number, h: number): { x: number; y: number; rotationDeg: number } | null => {
      const tolerance = h / 2 + 400;
      // Rank every wall by perpendicular distance so we can detect a corner
      // (two walls comparably close). Auto-rotating flush against "whichever
      // is nearest" made furniture flip 90° on a 1px move in a corner and
      // fought the user trying to nudge a bed into it. When two walls are
      // within ~250mm of each other's distance, treat it as a corner and
      // DON'T force an orientation — just let the piece sit where dropped
      // (grid-snapped, current rotation kept) so it slides in freely.
      const ranked = doc.walls
        .map((wall) => ({ wall, d: distanceToWall(wall, p) }))
        .filter((x) => x.d <= tolerance)
        .sort((a, b) => a.d - b.d);
      if (ranked.length === 0) return null;
      const closest = ranked[0];
      const CORNER_EPS = 250;
      if (ranked.length > 1 && ranked[1].d - closest.d < CORNER_EPS) {
        // Ambiguous corner — signal "no forced alignment" so the caller
        // free-snaps position and preserves the existing rotation.
        return null;
      }
      const hit = { wall: closest.wall, offsetMm: nearestOffsetOnWall(closest.wall, p) };
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

  // 10px handles are fine under a mouse cursor but nearly impossible to
  // grab with a finger — on coarse pointers (touch screens) render them at
  // 24px so resize/reshape works on phones and tablets.
  const handleHalf = (COARSE_POINTER ? 12 : 5) / scale;

  // Smart default label positions (only for rooms the user hasn't manually
  // repositioned). Recomputed when rooms/furniture/walls change.
  const smartLabelOffsets = useMemo(() => {
    const m = new Map<string, Point>();
    for (const room of doc.rooms) {
      if (room.labelOffset || room.type === 'Stairs') continue;
      m.set(room.id, smartRoomLabelOffset(room, doc.symbols, doc.walls));
    }
    return m;
  }, [doc.rooms, doc.symbols, doc.walls]);

  // Rooms that overlap another GIA room — flagged amber on canvas (a drawing
  // mistake; GIA already counts the shared area once).
  const overlapRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of findRoomOverlaps(doc)) {
      ids.add(o.a.id);
      ids.add(o.b.id);
    }
    return ids;
  }, [doc]);

  const effectiveLabelOffset = (room: RoomRect): Point => {
    if (labelMoveDraft?.id === room.id) return labelMoveDraft.off;
    return room.labelOffset ?? smartLabelOffsets.get(room.id) ?? ZERO_POINT;
  };

  const roomLabelScale = (room: RoomRect): number =>
    labelScaleDraft?.id === room.id ? labelScaleDraft.scale : (room.labelScale ?? 1);

  const handleDragRef = useRef<HandleDrag | null>(null);

  // Which resize/reshape handle (if any) of the selected entity is under
  // the pointer. Checked BEFORE entity picking so a handle grab always
  // beats whatever sits underneath it — a room's corner handle lying on a
  // wall must start a resize, not select the wall.
  const pickHandleAt = (p: Point): HandleDrag | null => {
    if (!selectedId) return null;
    const tol = Math.max(handleHalf * 2.4, 18 / scale);
    const room = doc.rooms.find((r) => r.id === selectedId);
    if (room) {
      // Non-rectangular rooms are shaped by their walls, not a bbox resize —
      // no corner handles (they'd distort the polygon).
      const corners = room.polygon
        ? []
        : [
            { cx: room.x, cy: room.y, ox: room.x + room.w, oy: room.y + room.h },
            { cx: room.x + room.w, cy: room.y, ox: room.x, oy: room.y + room.h },
            { cx: room.x, cy: room.y + room.h, ox: room.x + room.w, oy: room.y },
            { cx: room.x + room.w, cy: room.y + room.h, ox: room.x, oy: room.y },
          ];
      for (const c of corners) {
        if (Math.hypot(p.x - c.cx, p.y - c.cy) <= tol) {
          return { kind: 'room-resize', room, ox: c.ox, oy: c.oy };
        }
      }
      if (room.type !== 'Stairs') {
        const s = room.labelScale ?? 1;
        const off = effectiveLabelOffset(room);
        const center = { x: room.x + room.w / 2 + off.x, y: room.y + room.h / 2 + off.y };
        const hp = { x: center.x + LABEL_HANDLE_BASE.x * s, y: center.y + LABEL_HANDLE_BASE.y * s };
        if (Math.hypot(p.x - hp.x, p.y - hp.y) <= tol) {
          return { kind: 'label-scale', entity: 'room', id: room.id, center };
        }
        // Grabbing the label text itself moves it freely — anywhere the user
        // likes, even outside the room (a leader-style label for tiny rooms).
        const halfW = Math.min(room.w * 0.5, 1400) * s;
        const halfH = 450 * s;
        if (Math.abs(p.x - center.x) <= halfW && Math.abs(p.y - center.y) <= halfH) {
          return { kind: 'room-label-move', room, startWorld: p, origin: off };
        }
      }
      return null;
    }
    const wall = doc.walls.find((w) => w.id === selectedId);
    if (wall) {
      if (Math.hypot(p.x - wall.a.x, p.y - wall.a.y) <= tol) return { kind: 'wall-end', wall, end: 'a' };
      if (Math.hypot(p.x - wall.b.x, p.y - wall.b.y) <= tol) return { kind: 'wall-end', wall, end: 'b' };
      return null;
    }
    const symbol = doc.symbols.find((s) => s.id === selectedId);
    if (symbol) {
      const center = { x: symbol.x + symbol.w / 2, y: symbol.y + symbol.h / 2 };
      // Rotation handle floats above the symbol's top edge (rotates with it).
      const rv = rotateVec({ x: 0, y: -(symbol.h / 2 + ROTATE_HANDLE_OFF_MM) }, symbol.rotationDeg);
      if (Math.hypot(p.x - (center.x + rv.x), p.y - (center.y + rv.y)) <= tol) {
        return { kind: 'symbol-rotate', symbol };
      }
      for (const sx of [-1, 1] as const) {
        for (const sy of [-1, 1] as const) {
          const v = rotateVec({ x: (sx * symbol.w) / 2, y: (sy * symbol.h) / 2 }, symbol.rotationDeg);
          if (Math.hypot(p.x - (center.x + v.x), p.y - (center.y + v.y)) <= tol) {
            const ov = rotateVec({ x: (-sx * symbol.w) / 2, y: (-sy * symbol.h) / 2 }, symbol.rotationDeg);
            return { kind: 'symbol-resize', symbol, sx, sy, opp: { x: center.x + ov.x, y: center.y + ov.y } };
          }
        }
      }
      return null;
    }
    const label = doc.labels.find((l) => l.id === selectedId);
    if (label) {
      const s = label.scale ?? 1;
      const center = { x: label.x, y: label.y + 110 * s };
      const hp = { x: center.x + LABEL_HANDLE_BASE.x * s, y: center.y + LABEL_HANDLE_BASE.y * s };
      if (Math.hypot(p.x - hp.x, p.y - hp.y) <= tol) {
        return { kind: 'label-scale', entity: 'text', id: label.id, center };
      }
    }
    return null;
  };

  // Is the point over the (unlocked) photo underlay?
  const underlayAt = (p: Point): boolean => {
    const u = doc.underlay;
    if (!u || u.locked || !underlayImg) return false;
    const h = u.widthMm * (underlayImg.naturalHeight / underlayImg.naturalWidth);
    return p.x >= u.xMm && p.x <= u.xMm + u.widthMm && p.y >= u.yMm && p.y <= u.yMm + h;
  };

  /* ---- shared pointer logic (mouse + single touch) ---- */

  const pointerDown = (isStageTarget: boolean, screen: Point) => {
    // Dedicated hand tool: any drag pans, no matter what's under the
    // pointer — the discoverable, on-screen equivalent of Space+drag.
    if (tool === 'pan') {
      panDrag.current = { pointer: screen, pan };
      return;
    }
    if (tool === 'select') {
      if (spacePressed) {
        panDrag.current = { pointer: screen, pan };
        return;
      }
      // Only the (unlocked) underlay image still listens/drags via Konva;
      // if it was grabbed, e.target isn't the stage — let Konva drive it.
      if (!isStageTarget) return;
      const raw = pointerWorld();
      if (!raw) return;
      // Resize/reshape handles first: a handle grab must beat the entity
      // underneath it (a room's corner handle often lies ON a wall).
      const grabbedHandle = pickHandleAt(raw);
      if (grabbedHandle) {
        handleDragRef.current = grabbedHandle;
        return;
      }
      // Geometric hit-test — independent of Konva's (Brave-broken) pixel
      // hit canvas. Picks the top-most entity under the cursor by the same
      // priority the context menu uses (symbol → label → opening → wall →
      // room).
      const hit = pickEntityAt(raw);
      const additive = pointerMods.current.additive;
      if (!hit) {
        // No entity here — if an unlocked photo underlay is under the
        // pointer, grab it to reposition (geometric, so Brave-safe). Grab
        // an empty part of the underlay (not covered by a room) to move it.
        if (underlayAt(raw) && doc.underlay) {
          underlayDragRef.current = { startWorld: raw, origin: { x: doc.underlay.xMm, y: doc.underlay.yMm } };
          setUnderlayDrag({ x: 0, y: 0 });
          return;
        }
        setMarqueeDraft({ a: raw, b: raw });
        if (!additive) select(null);
        return;
      }
      if (additive) {
        toggleSelect(hit.id, true);
        return;
      }
      // An opening drags by sliding along its wall (offsetMm), not by XY.
      if (hit.kind === 'opening') {
        select(hit.id);
        const opening = doc.openings.find((o) => o.id === hit.id);
        if (opening) openingDrag.current = { id: opening.id, wallId: opening.wallId };
        return;
      }
      // Every hit entity — walls included — is grabbable: a click selects,
      // a drag moves. Grabbing the wall BODY translates the whole wall;
      // its endpoint handles (separate listening nodes) still reshape it.
      const inMulti = selectedIds.length > 1 && selectedIds.includes(hit.id);
      if (!inMulti) select(hit.id);
      const ids = inMulti ? selectedIds : [hit.id];
      manualDragRef.current = { ids, startWorld: raw, single: ids.length === 1 };
      setManualDrag({ ids, delta: { x: 0, y: 0 } });
      return;
    }
    const raw = pointerWorld();
    if (!raw) return;

    if (tool === 'wall') {
      const pt =
        wallStart && pointerMods.current.shift ? constrainOrthoTo(raw, wallStart) : snapEnd(raw, wallStart);
      if (!wallStart) {
        setWallStart(pt);
        setHoverPt(pt);
      } else if (distance(wallStart, pt) >= 10) {
        let next = addWall(doc, { id: newId(), a: wallStart, b: pt, thickness: drawThickness });
        // Auto internal/external thickness: with rooms on the plan, a wall
        // on the exposed boundary becomes 200mm and partitions 100mm as you
        // draw — no re-typing afterwards. Custom thicknesses are preserved,
        // and with no rooms yet nothing is touched.
        if (autoWallThickness) next = autoClassifyWallThickness(next);
        commit('Draw wall', next);
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
      roomDownScreen.current = screen;
      // Room tool with a polygon already in progress: each subsequent click
      // places a vertex (handled on pointer-up), so don't arm a rectangle.
      if (tool === 'room' && polyDraft) {
        setHoverPt(snapFree(raw));
        return;
      }
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
    if (handleDragRef.current) {
      const h = handleDragRef.current;
      const raw = worldFromClient(screen);
      if (!raw) return;
      guardDrag('Handle drag', () => {
        if (h.kind === 'room-resize') {
          const snapped = snapFree(raw);
          let nx = snapped.x;
          let ny = snapped.y;
          if (Math.abs(nx - h.ox) < MIN_ROOM_MM) nx = h.ox + Math.sign(nx - h.ox || 1) * MIN_ROOM_MM;
          if (Math.abs(ny - h.oy) < MIN_ROOM_MM) ny = h.oy + Math.sign(ny - h.oy || 1) * MIN_ROOM_MM;
          setResizeDraft({
            ...h.room,
            x: Math.min(nx, h.ox),
            y: Math.min(ny, h.oy),
            w: Math.abs(nx - h.ox),
            h: Math.abs(ny - h.oy),
          });
        } else if (h.kind === 'wall-end') {
          const other = h.end === 'a' ? h.wall.b : h.wall.a;
          const snapped = snapEndFree(raw, other);
          if (distance(snapped, other) < 100) return; // refuse to collapse the wall
          setWallEndDraft({
            id: h.wall.id,
            a: h.end === 'a' ? snapped : h.wall.a,
            b: h.end === 'b' ? snapped : h.wall.b,
          });
        } else if (h.kind === 'symbol-resize') {
          // Diagonal from the fixed opposite corner, in the symbol's frame.
          const d = rotateVec({ x: raw.x - h.opp.x, y: raw.y - h.opp.y }, -h.symbol.rotationDeg);
          const nw = Math.max(MIN_SYMBOL_MM, Math.abs(d.x));
          const nh = Math.max(MIN_SYMBOL_MM, Math.abs(d.y));
          const half = rotateVec({ x: (h.sx * nw) / 2, y: (h.sy * nh) / 2 }, h.symbol.rotationDeg);
          const nc = { x: h.opp.x + half.x, y: h.opp.y + half.y };
          setSymbolResizeDraft({ ...h.symbol, w: nw, h: nh, x: nc.x - nw / 2, y: nc.y - nh / 2 });
        } else if (h.kind === 'room-label-move') {
          setLabelMoveDraft({
            id: h.room.id,
            off: { x: h.origin.x + (raw.x - h.startWorld.x), y: h.origin.y + (raw.y - h.startWorld.y) },
          });
        } else if (h.kind === 'symbol-rotate') {
          // Angle from the symbol centre to the pointer; the handle sits at
          // the top edge, so straight up = 0°. Snap to 15° steps — hold
          // Shift for free rotation.
          const cx = h.symbol.x + h.symbol.w / 2;
          const cy = h.symbol.y + h.symbol.h / 2;
          let deg = (Math.atan2(raw.y - cy, raw.x - cx) * 180) / Math.PI + 90;
          if (!pointerMods.current.shift) deg = Math.round(deg / 15) * 15;
          deg = ((deg % 360) + 360) % 360;
          setSymbolRotateDraft({ id: h.symbol.id, deg });
        } else {
          const ns = Math.max(
            0.5,
            Math.min(3, Math.hypot(raw.x - h.center.x, raw.y - h.center.y) / LABEL_HANDLE_BASE_MAG),
          );
          setLabelScaleDraft({ id: h.id, scale: ns });
        }
      });
      return;
    }
    if (underlayDragRef.current) {
      const raw = worldFromClient(screen);
      if (raw) {
        const ud = underlayDragRef.current;
        setUnderlayDrag({ x: raw.x - ud.startWorld.x, y: raw.y - ud.startWorld.y });
      }
      return;
    }
    if (manualDragRef.current) {
      const raw = worldFromClient(screen);
      if (raw) {
        const md = manualDragRef.current;
        setManualDrag({
          ids: md.ids,
          delta: { x: raw.x - md.startWorld.x, y: raw.y - md.startWorld.y },
        });
      }
      return;
    }
    if (marqueeDraft) {
      const raw = worldFromClient(screen);
      if (raw) setMarqueeDraft({ a: marqueeDraft.a, b: raw });
      return;
    }
    if (openingDrag.current) {
      const raw = worldFromClient(screen);
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
      const raw = worldFromClient(screen);
      if (raw) {
        // Shift locks to 45° increments — takes priority over corner
        // alignment (which would tug the point back off the axis).
        if (wallStart && pointerMods.current.shift) {
          setAlignGuides(null);
          setHoverPt(constrainOrthoTo(raw, wallStart));
          return;
        }
        let pt = snapEnd(raw, wallStart);
        // Smart alignment: when the pending point lines up (within ~6px on
        // screen) with any existing wall corner on the X or Y axis, pull it
        // exactly onto that axis and remember which corner matched so a
        // dashed guide can be drawn through it.
        const tol = 6 / scale;
        let gx: number | null = null;
        let gy: number | null = null;
        for (const w of doc.walls) {
          for (const p of [w.a, w.b]) {
            // The pending point isn't in doc.walls yet, so there's no self to
            // exclude — an exact axis match is precisely when the guide
            // should show (it confirms the snap landed on that corner's
            // line). Skip the wall's own start point so a chain in progress
            // doesn't guide against where it just began.
            if (wallStart && p.x === wallStart.x && p.y === wallStart.y) continue;
            if (gx === null && Math.abs(p.x - pt.x) <= tol) gx = p.x;
            if (gy === null && Math.abs(p.y - pt.y) <= tol) gy = p.y;
          }
        }
        if (gx !== null) pt = { ...pt, x: gx };
        if (gy !== null) pt = { ...pt, y: gy };
        setAlignGuides(gx !== null || gy !== null ? { x: gx, y: gy } : null);
        setHoverPt(pt);
      }
    } else if (tool === 'measure' && measureA) {
      const raw = worldFromClient(screen);
      if (raw) setHoverPt(snapFree(raw));
    } else if (isDraftingTool(tool)) {
      const raw = worldFromClient(screen);
      if (raw) {
        if (tool === 'room' && polyDraft) setHoverPt(snapFree(raw));
        else if (rectDraft) setRectDraft({ ...rectDraft, b: snapFree(raw) });
      }
    } else if (tool === 'door' || tool === 'window') {
      const raw = worldFromClient(screen);
      if (raw) {
        const hit = nearestWall(doc, raw, wallHitToleranceMm);
        setOpeningHover(hit ? { wall: hit.wall, offsetMm: hit.offsetMm } : null);
      }
    }
  };

  // Turn a clicked-out polygon into a shaped room (walls + thickness like a
  // drawn rectangle). A 4-point axis-aligned outline collapses back to a plain
  // rectangle so it still gets W/L steppers.
  const finishPolyRoom = useCallback(
    (pts: Point[]) => {
      setPolyDraft(null);
      setHoverPt(null);
      roomDownScreen.current = null;
      if (pts.length < 3) return;
      const b = ringBounds(pts);
      if (b.w < MIN_ROOM_MM || b.h < MIN_ROOM_MM) return;
      const isRect =
        pts.length === 4 &&
        pts.every((p, i) => {
          const q = pts[(i + 1) % 4];
          return Math.abs(p.x - q.x) < 2 || Math.abs(p.y - q.y) < 2;
        });
      const room: RoomRect = {
        id: newId(),
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        ...(isRect ? {} : { polygon: pts }),
        name: `Room ${doc.rooms.length + 1}`,
        type: 'Other',
        ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
        includeInGia: true,
      };
      let next = addRoom(doc, room);
      if (autoRoomWalls) {
        for (const wall of wallsForPolygon(doc, pts)) next = addWall(next, wall);
        if (autoWallThickness) next = autoClassifyWallThickness(next);
      }
      commit('Add room', next);
      select(room.id);
    },
    [doc, autoRoomWalls, autoWallThickness, commit, select],
  );

  /* Polygon room: Enter finishes the outline, Backspace removes the last
     vertex placed. */
  useEffect(() => {
    if (!polyDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (polyDraft.length >= 3) finishPolyRoom(polyDraft);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setPolyDraft(polyDraft.length <= 1 ? null : polyDraft.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [polyDraft, finishPolyRoom]);

  const pointerUp = (client?: Point) => {
    panDrag.current = null;

    if (handleDragRef.current) {
      const h = handleDragRef.current;
      handleDragRef.current = null;
      guardDrag('Commit handle drag', () => {
        if (h.kind === 'room-resize') {
          const draft = resizeDraft;
          setResizeDraft(null);
          if (draft && draft.id === h.room.id) {
            commit('Resize room', updateRoom(doc, h.room.id, { x: draft.x, y: draft.y, w: draft.w, h: draft.h }));
          }
        } else if (h.kind === 'wall-end') {
          const draft = wallEndDraft;
          setWallEndDraft(null);
          if (draft && draft.id === h.wall.id) {
            commit('Reshape wall', updateWall(doc, h.wall.id, h.end === 'a' ? { a: draft.a } : { b: draft.b }));
          }
        } else if (h.kind === 'symbol-resize') {
          const draft = symbolResizeDraft;
          setSymbolResizeDraft(null);
          if (draft && draft.id === h.symbol.id) {
            commit(
              'Resize furniture',
              updateSymbol(doc, h.symbol.id, { x: draft.x, y: draft.y, w: draft.w, h: draft.h }),
            );
          }
        } else if (h.kind === 'symbol-rotate') {
          const draft = symbolRotateDraft;
          setSymbolRotateDraft(null);
          if (draft && draft.id === h.symbol.id && draft.deg !== h.symbol.rotationDeg) {
            commit('Rotate furniture', updateSymbol(doc, h.symbol.id, { rotationDeg: draft.deg }));
          }
        } else if (h.kind === 'room-label-move') {
          const draft = labelMoveDraft;
          setLabelMoveDraft(null);
          if (draft && draft.id === h.room.id) {
            commit('Move label', updateRoom(doc, h.room.id, { labelOffset: draft.off }));
          }
        } else {
          const draft = labelScaleDraft;
          setLabelScaleDraft(null);
          if (draft && draft.id === h.id) {
            if (h.entity === 'room') {
              commit('Resize label', updateRoom(doc, h.id, { labelScale: draft.scale }));
            } else {
              commit('Resize label', updateLabel(doc, h.id, { scale: draft.scale }));
            }
          }
        }
      });
      return;
    }

    if (underlayDragRef.current) {
      const ud = underlayDragRef.current;
      underlayDragRef.current = null;
      const raw = client ? worldFromClient(client) : pointerWorld();
      const delta = raw ? { x: raw.x - ud.startWorld.x, y: raw.y - ud.startWorld.y } : { x: 0, y: 0 };
      setUnderlayDrag(null);
      if (doc.underlay && (delta.x !== 0 || delta.y !== 0)) {
        guardDrag('Move underlay', () =>
          commit('Move underlay', {
            ...doc,
            underlay: { ...doc.underlay!, xMm: ud.origin.x + delta.x, yMm: ud.origin.y + delta.y },
          }),
        );
      }
      return;
    }

    if (manualDragRef.current) {
      const md = manualDragRef.current;
      manualDragRef.current = null;
      const raw = client ? worldFromClient(client) : pointerWorld();
      const delta = raw ? { x: raw.x - md.startWorld.x, y: raw.y - md.startWorld.y } : { x: 0, y: 0 };
      setManualDrag(null);
      // Below the threshold it was a click, not a drag — selection already
      // happened on pointerDown, so there's nothing to commit.
      if (Math.hypot(delta.x, delta.y) >= 6 / scale) {
        guardDrag('Move selection', () => commitManualMove(md.ids, delta));
      }
      return;
    }

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

    if (isDraftingTool(tool)) {
      roomDownScreen.current = null;
      const dw = rectDraft ? Math.abs(rectDraft.b.x - rectDraft.a.x) : 0;
      const dh = rectDraft ? Math.abs(rectDraft.b.y - rectDraft.a.y) : 0;
      const bigDrag = dw >= MIN_ROOM_MM && dh >= MIN_ROOM_MM;

      // Room tool with a click or too-small drag: build a shaped room vertex by
      // vertex. A drag big enough to be a room draws a rectangle below; stairs
      // are always a rectangle.
      if (tool === 'room' && (polyDraft || !bigDrag)) {
        setRectDraft(null);
        const upWorld = client ? worldFromClient(client) : pointerWorld();
        if (!upWorld) return;
        const pt = snapFree(upWorld);
        if (!polyDraft) {
          setPolyDraft([pt]);
          setHoverPt(pt);
          return;
        }
        // Click on/near the first vertex closes the outline.
        const first = polyDraft[0];
        if (polyDraft.length >= 3 && Math.hypot((pt.x - first.x) * scale, (pt.y - first.y) * scale) < 14) {
          finishPolyRoom(polyDraft);
          return;
        }
        // Ignore a repeat click on the last vertex (would be a zero-length edge).
        const last = polyDraft[polyDraft.length - 1];
        if (Math.hypot((pt.x - last.x) * scale, (pt.y - last.y) * scale) < 3) return;
        setPolyDraft([...polyDraft, pt]);
        setHoverPt(pt);
        return;
      }

      if (rectDraft && bigDrag) {
        const x = Math.min(rectDraft.a.x, rectDraft.b.x);
        const y = Math.min(rectDraft.a.y, rectDraft.b.y);
        const w = dw;
        const h = dh;
        const stairs = rectDraft.stairs;
        setRectDraft(null);

        // A room dragged over existing rooms is carved to fit AROUND them
        // (drawn rectangle minus those rooms), so it never overlaps and honours
        // the walls already dividing the space — the drag-based way to get an
        // L/T/U. Stairs are exempt (they sit inside a room by design).
        const drawnRing: Point[] = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ];
        const overlapped = stairs
          ? []
          : doc.rooms.filter((r) => r.type !== 'Stairs' && ringsOverlap(roomPolygon(r), drawnRing));
        if (overlapped.length > 0) {
          const piece = differenceRectilinear(drawnRing, overlapped.map(roomPolygon))[0];
          const bb = piece ? ringBounds(piece) : null;
          // Fully covered, or only a sliver survives — nothing worth adding.
          if (!piece || !bb || bb.w < MIN_ROOM_MM || bb.h < MIN_ROOM_MM) return;
          const isRect =
            piece.length === 4 &&
            piece.every((p, i) => {
              const q = piece[(i + 1) % 4];
              return Math.abs(p.x - q.x) < 2 || Math.abs(p.y - q.y) < 2;
            });
          const room: RoomRect = {
            id: newId(),
            x: bb.x,
            y: bb.y,
            w: bb.w,
            h: bb.h,
            ...(isRect ? {} : { polygon: piece }),
            name: `Room ${doc.rooms.length + 1}`,
            type: 'Other',
            ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
            includeInGia: true,
          };
          let next = addRoom(doc, room);
          if (autoRoomWalls) {
            for (const wall of wallsForPolygon(next, piece)) next = addWall(next, wall);
            if (autoWallThickness) next = autoClassifyWallThickness(next);
          }
          commit('Add room', next);
          select(room.id);
          return;
        }

        // Plain new room / stairs.
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
        let next = addRoom(doc, room);
        // A drawn room auto-encloses itself: walls appear along any edge that
        // doesn't already have one (a shared wall with the neighbour is reused,
        // not doubled), then thicknesses are classified so the boundary comes
        // out external and partitions internal.
        if (!stairs && autoRoomWalls) {
          for (const wall of wallsForRoom(doc, room)) next = addWall(next, wall);
          if (autoWallThickness) next = autoClassifyWallThickness(next);
        }
        commit(stairs ? 'Add stairs' : 'Add room', next);
        select(room.id);
        return;
      }
      setRectDraft(null);
    }
  };

  // Konva only delivers mouse events while the pointer is over the Stage,
  // so a drag that strays past the canvas edge used to go dead: no more
  // move updates and — worse — the mouseup was lost, leaving the drag
  // armed and the gesture uncommitted. (Konva-draggable shapes attached
  // their own window listeners, which is why handles never used to have
  // this problem — the geometric pipeline needs the same.) While any drag
  // is active, window-level listeners take over the moment the pointer is
  // outside the canvas; inside it, the Stage handlers drive as usual.
  useEffect(() => {
    const dragActive = () =>
      !!handleDragRef.current ||
      !!manualDragRef.current ||
      !!underlayDragRef.current ||
      !!openingDrag.current ||
      !!panDrag.current ||
      !!marqueeDraft ||
      !!rectDraft;
    const outsideCanvas = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onWinMove = (e: MouseEvent) => {
      if (dragActive() && outsideCanvas(e)) pointerMove({ x: e.clientX, y: e.clientY });
    };
    const onWinUp = (e: MouseEvent) => {
      if (dragActive() && outsideCanvas(e)) pointerUp({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', onWinMove);
    window.addEventListener('mouseup', onWinUp);
    return () => {
      window.removeEventListener('mousemove', onWinMove);
      window.removeEventListener('mouseup', onWinUp);
    };
  });

  /* ---- mouse events ---- */

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    setContextMenu(null);
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      panDrag.current = { pointer: { x: e.evt.clientX, y: e.evt.clientY }, pan };
      return;
    }
    if (e.evt.button !== 0) return;
    pointerMods.current.additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    pointerMods.current.shift = e.evt.shiftKey;
    pointerDown(e.target === stageRef.current, { x: e.evt.clientX, y: e.evt.clientY });
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    pointerMods.current.shift = e.evt.shiftKey;
    pointerMove({ x: e.evt.clientX, y: e.evt.clientY });
  };

  // Double-click a room to rename it: selects the room and asks the panel to
  // focus its name field. Select tool only, so drawing tools stay unaffected.
  const onDblClick = () => {
    if (tool !== 'select') return;
    const raw = pointerWorld();
    if (!raw) return;
    const room = pickRoomAt(raw);
    if (room && room.type !== 'Stairs') {
      select(room.id);
      requestFocusName();
    }
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
    pointerMods.current.additive = false; // no modifier keys on touch
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

  // The primary anchor point of an entity (used to snap a manual drag delta
  // to the grid). Rooms/symbols/labels have an x/y; a wall uses endpoint a.
  const entityAnchor = useCallback(
    (id: string): Point | null => {
      const room = doc.rooms.find((r) => r.id === id);
      if (room) return { x: room.x, y: room.y };
      const sym = doc.symbols.find((s) => s.id === id);
      if (sym) return { x: sym.x, y: sym.y };
      const label = doc.labels.find((l) => l.id === id);
      if (label) return { x: label.x, y: label.y };
      const wall = doc.walls.find((w) => w.id === id);
      if (wall) return { x: wall.a.x, y: wall.a.y };
      return null;
    },
    [doc],
  );

  // Commit a geometric drag of `ids` by `rawDelta`, grid-snapped. A single
  // furniture symbol also re-runs wall-alignment so it still tucks flush to
  // a nearby wall the way a placed piece does.
  const commitManualMove = useCallback(
    (ids: string[], rawDelta: Point) => {
      if (ids.length === 0) return;
      const anchor = entityAnchor(ids[0]);
      if (!anchor) return;
      const snapped = snapFree({ x: anchor.x + rawDelta.x, y: anchor.y + rawDelta.y });
      const dx = snapped.x - anchor.x;
      const dy = snapped.y - anchor.y;
      if (dx === 0 && dy === 0) return;

      if (ids.length === 1) {
        const id = ids[0];
        const sym = doc.symbols.find((s) => s.id === id);
        if (sym) {
          const nx = sym.x + dx;
          const ny = sym.y + dy;
          const aligned = alignToNearbyWall({ x: nx + sym.w / 2, y: ny + sym.h / 2 }, sym.w, sym.h);
          commit(
            'Move symbol',
            aligned
              ? updateSymbol(doc, id, { x: aligned.x, y: aligned.y, rotationDeg: aligned.rotationDeg })
              : updateSymbol(doc, id, { x: nx, y: ny }),
          );
          return;
        }
        const room = doc.rooms.find((r) => r.id === id);
        if (room) {
          commit(
            'Move room',
            updateRoom(doc, id, {
              x: room.x + dx,
              y: room.y + dy,
              // Polygon outline is absolute, so translate it too.
              ...(room.polygon ? { polygon: room.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
            }),
          );
          return;
        }
        const label = doc.labels.find((l) => l.id === id);
        if (label) {
          commit('Move label', updateLabel(doc, id, { x: label.x + dx, y: label.y + dy }));
          return;
        }
        const wall = doc.walls.find((w) => w.id === id);
        if (wall) {
          commit(
            'Move wall',
            updateWall(doc, id, {
              a: { x: wall.a.x + dx, y: wall.a.y + dy },
              b: { x: wall.b.x + dx, y: wall.b.y + dy },
            }),
          );
          return;
        }
        return; // openings slide along their wall, handled separately
      }

      // Multi-selection: uniform delta across every selected entity.
      let next = doc;
      for (const id of ids) {
        const room = next.rooms.find((r) => r.id === id);
        if (room) {
          next = updateRoom(next, id, {
            x: room.x + dx,
            y: room.y + dy,
            ...(room.polygon ? { polygon: room.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
          });
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
    },
    [doc, entityAnchor, snapFree, alignToNearbyWall, commit],
  );

  /* ---- render helpers ---- */

  // Live visual offset for an entity during a geometric (manual) drag.
  const manualOffset = (id: string): Point =>
    manualDrag && manualDrag.ids.includes(id) ? manualDrag.delta : ZERO_POINT;

  const selectedRoom = doc.rooms.find((r) => r.id === selectedId) ?? null;
  const selectedWall = doc.walls.find((w) => w.id === selectedId) ?? null;
  const selectedSymbol = doc.symbols.find((s) => s.id === selectedId) ?? null;
  const selectedLabel = doc.labels.find((l) => l.id === selectedId) ?? null;
  /* All handles below are pure visuals (listening={false}): grabbing and
     dragging them is driven by pickHandleAt + the shared pointer pipeline,
     never by Konva hit detection. */

  const renderResizeHandles = (room: RoomRect) => {
    const r = resizeDraft?.id === room.id ? resizeDraft : room;
    const corners = [
      { cx: r.x, cy: r.y },
      { cx: r.x + r.w, cy: r.y },
      { cx: r.x, cy: r.y + r.h },
      { cx: r.x + r.w, cy: r.y + r.h },
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
        listening={false}
      />
    ));
  };

  const renderWallEndHandles = (wall: Wall) => {
    const w = wallEndDraft?.id === wall.id ? wallEndDraft : wall;
    return (['a', 'b'] as const).map((key) => (
      <Circle
        key={`wall-handle-${key}`}
        x={w[key].x}
        y={w[key].y}
        radius={handleHalf}
        fill="#FFFFFF"
        stroke={ACTION}
        strokeWidth={2 / scale}
        listening={false}
      />
    ));
  };

  // Corner handles at the selected furniture's rotated corners.
  const renderSymbolResizeHandles = (symbol: SymbolInstance) => {
    const s = symbolResizeDraft?.id === symbol.id ? symbolResizeDraft : symbol;
    const center = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    return ([-1, 1] as const).flatMap((sx) =>
      ([-1, 1] as const).map((sy) => {
        const v = rotateVec({ x: (sx * s.w) / 2, y: (sy * s.h) / 2 }, s.rotationDeg);
        return (
          <Rect
            key={`sym-handle-${sx},${sy}`}
            x={center.x + v.x - handleHalf}
            y={center.y + v.y - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
            fill="#FFFFFF"
            stroke={ACTION}
            strokeWidth={2 / scale}
            listening={false}
          />
        );
      }),
    );
  };

  const renderSymbolRotateHandle = (symbol: SymbolInstance) => {
    const s = symbolResizeDraft?.id === symbol.id ? symbolResizeDraft : symbol;
    const deg = symbolRotateDraft?.id === symbol.id ? symbolRotateDraft.deg : s.rotationDeg;
    const center = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    const top = rotateVec({ x: 0, y: -s.h / 2 }, deg);
    const knob = rotateVec({ x: 0, y: -(s.h / 2 + ROTATE_HANDLE_OFF_MM) }, deg);
    return (
      <>
        <Line
          points={[center.x + top.x, center.y + top.y, center.x + knob.x, center.y + knob.y]}
          stroke={ACTION}
          strokeWidth={2 / scale}
          dash={[6 / scale, 4 / scale]}
          listening={false}
        />
        <Circle
          x={center.x + knob.x}
          y={center.y + knob.y}
          radius={handleHalf * 1.1}
          fill="#FFFFFF"
          stroke={ACTION}
          strokeWidth={2 / scale}
          listening={false}
        />
      </>
    );
  };

  const renderRoomLabelHandle = (room: RoomRect) => {
    const scaleVal = roomLabelScale(room);
    const off = effectiveLabelOffset(room);
    const center = { x: room.x + room.w / 2 + off.x, y: room.y + room.h / 2 + off.y };
    return (
      <Circle
        x={center.x + LABEL_HANDLE_BASE.x * scaleVal}
        y={center.y + LABEL_HANDLE_BASE.y * scaleVal}
        radius={handleHalf}
        fill="#FFFFFF"
        stroke={ACTION}
        strokeWidth={2 / scale}
        listening={false}
      />
    );
  };

  const renderTextLabelHandle = (label: TextLabel) => {
    const scaleVal = labelScaleDraft?.id === label.id ? labelScaleDraft.scale : (label.scale ?? 1);
    const center = { x: label.x, y: label.y + 110 * scaleVal };
    return (
      <Circle
        x={center.x + LABEL_HANDLE_BASE.x * scaleVal}
        y={center.y + LABEL_HANDLE_BASE.y * scaleVal}
        radius={handleHalf}
        fill="#FFFFFF"
        stroke={ACTION}
        strokeWidth={2 / scale}
        listening={false}
      />
    );
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
          label: 'Rename',
          onClick: () => {
            select(room.id);
            requestFocusName();
          },
        });
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
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        onMouseUp={(e) => pointerUp({ x: e.evt.clientX, y: e.evt.clientY })}
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
          {/* Photo underlay for tracing (below everything). Non-interactive:
              dragging it runs through the Stage-level geometric pipeline
              (grab an empty part with Select), so it works under Brave too.
              `underlayDrag` is the live preview offset. */}
          {underlayImg && doc.underlay && (
            <KonvaImage
              image={underlayImg}
              x={doc.underlay.xMm + (underlayDrag?.x ?? 0)}
              y={doc.underlay.yMm + (underlayDrag?.y ?? 0)}
              width={doc.underlay.widthMm}
              height={doc.underlay.widthMm * (underlayImg.naturalHeight / underlayImg.naturalWidth)}
              opacity={doc.underlay.opacity}
              listening={false}
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
            const off = manualOffset(room.id);
            const overlapping = overlapRoomIds.has(room.id);
            return (
              // Selection + dragging are handled by the Stage-level geometric
              // pointer pipeline (pickEntityAt), NOT Konva's pixel hit canvas
              // — so no onClick/draggable here. `off` is the live drag preview.
              <Group
                key={room.id}
                x={r.x + off.x}
                y={r.y + off.y}
                listening={false}
              >
                {r.polygon && r.polygon.length >= 3 ? (
                  // Non-rectangular room (bay/chamfer/L-shape): draw its exact
                  // outline, points relative to the group origin (r.x, r.y).
                  <Line
                    points={r.polygon.flatMap((p) => [p.x - r.x, p.y - r.y])}
                    closed
                    fill={isSel ? SELECT_FILL : (zone?.fill ?? '#FFFFFF')}
                    stroke={isSel ? ACTION : overlapping ? WARN : (zone?.edge ?? ROOM_EDGE)}
                    strokeWidth={isSel ? 34 : overlapping ? 28 : 18}
                    dash={isSel ? [110, 75] : overlapping ? [140, 90] : undefined}
                    lineJoin="round"
                    listening={false}
                  />
                ) : (
                  <Rect
                    width={r.w}
                    height={r.h}
                    fill={isSel ? SELECT_FILL : (zone?.fill ?? '#FFFFFF')}
                    stroke={isSel ? ACTION : overlapping ? WARN : (zone?.edge ?? ROOM_EDGE)}
                    strokeWidth={isSel ? 34 : overlapping ? 28 : 18}
                    dash={isSel ? [110, 75] : overlapping ? [140, 90] : undefined}
                  />
                )}
                {stairs ? (
                  <StairsTreads room={r} />
                ) : (
                  /* Name + area/height label. Non-interactive (listening
                     false) so it never intercepts a click meant for the
                     room — selection/drag is entirely geometric now. Any
                     saved labelOffset is still honoured for position. The
                     halo keeps it readable over furniture. */
                  (() => {
                    const areaText = formatArea(roomAreaM2(r), areaUnits);
                    // Same fit rule the export uses: shrink to sit inside a
                    // small room (porch, WC) instead of leaking over walls.
                    const fit = roomLabelShrink({ ...r, labelScale: 1 }, [r.name, areaText]);
                    const ls = roomLabelScale(room) * fit;
                    return (
                      <Group
                        x={effectiveLabelOffset(room).x}
                        y={effectiveLabelOffset(room).y}
                        listening={false}
                      >
                        <Text
                          text={r.name}
                          width={r.w}
                          y={r.h / 2 - 320 * ls}
                          align="center"
                          fontSize={260 * ls}
                          fontFamily={SANS}
                          fontStyle="600"
                          fill={INK}
                          stroke="#FFFFFF"
                          strokeWidth={30 * fit}
                          fillAfterStrokeEnabled
                        />
                        {showRoomLabels && (
                          <>
                            <Text
                              text={areaText}
                              width={r.w}
                              y={r.h / 2 + 60 * ls}
                              align="center"
                              fontSize={185 * ls}
                              fontFamily={MONO}
                              fill={FAINT}
                              stroke="#FFFFFF"
                              strokeWidth={26 * fit}
                              fillAfterStrokeEnabled
                            />
                            <Text
                              text={formatDims(r.displayWMm ?? r.w, r.displayLMm ?? r.h)}
                              width={r.w}
                              y={r.h / 2 + 285 * ls}
                              align="center"
                              fontSize={160 * ls}
                              fontFamily={MONO}
                              fill={FAINT}
                              stroke="#FFFFFF"
                              strokeWidth={24 * fit}
                              fillAfterStrokeEnabled
                            />
                          </>
                        )}
                      </Group>
                    );
                  })()
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
            // Selection is geometric (pickEntityAt); a lone wall reshapes via
            // its endpoint handles and only rides along bodily as part of a
            // multi-selection group drag, previewed here via manualOffset.
            const off = manualOffset(w.id);
            const dw = { a: { x: w.a.x + off.x, y: w.a.y + off.y }, b: { x: w.b.x + off.x, y: w.b.y + off.y } };
            // Square caps overshoot the endpoint by half the stroke width —
            // wanted at true wall ends (they fill the outer corners where
            // walls meet) but wrong at an opening, where the cap then pokes
            // half a wall-thickness into the door/window gap and sits proud
            // of the frame. So pull each *jamb* end back by half-thickness;
            // the square cap then lands exactly flush at the jamb. True wall
            // ends (dw.a / dw.b) are left alone.
            // Mitred wall bodies (core walljoin): quads meet cleanly at ANY
            // joint angle instead of a square cap poking out at 45° joins.
            const liveWalls = doc.walls.map((ow) => {
              const base = wallEndDraft?.id === ow.id ? { ...ow, a: wallEndDraft.a, b: wallEndDraft.b } : ow;
              const o2 = manualOffset(ow.id);
              return o2.x || o2.y
                ? { ...base, a: { x: base.a.x + o2.x, y: base.a.y + o2.y }, b: { x: base.b.x + o2.x, y: base.b.y + o2.y } }
                : base;
            });
            const liveW = { ...w, ...dw };
            return wallBodyQuads(liveW, liveWalls, openings).map((quad, i) => (
              <Line
                key={`${w.id}-${i}`}
                points={quad.flatMap((p) => [p.x, p.y])}
                closed
                fill={isSel ? ACTION : WALL}
                listening={false}
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
              const len = wallLengthMm(w);
              // Sub-40cm stubs (porch steps, jamb returns) can't fit a
              // readable label — their neighbours' labels tell the story.
              if (len < 400) return null;
              const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
              const n = wallNormal(w);
              // Short walls get a smaller label pushed further out so
              // clustered runs (bay steps) stop overlapping each other.
              const short = len < 1100;
              const fontSize = short ? 118 : 155;
              const offset = w.thickness / 2 + (short ? 430 : 320);
              let angle = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
              if (angle > 90) angle -= 180;
              else if (angle <= -90) angle += 180;
              const overridden = w.displayLengthMm !== undefined;
              return (
                <Text
                  key={`dim-${w.id}`}
                  x={mid.x + n.x * offset}
                  y={mid.y + n.y * offset}
                  rotation={angle}
                  text={formatMmAsM(w.displayLengthMm ?? len)}
                  width={1600}
                  align="center"
                  offsetX={800}
                  offsetY={80}
                  fontSize={fontSize}
                  fontStyle={overridden ? 'italic' : 'normal'}
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
          {showDimensions && doc.walls.length > 0 && wallComponents(doc.walls).map((group, gi) => {
            // One width/height pair per detached structure — matching the
            // exported sheet, so two storeys drawn side by side each get
            // their own overall dimensions instead of one spanning line.
            const minX = Math.min(...group.flatMap((w) => [w.a.x, w.b.x]));
            const maxX = Math.max(...group.flatMap((w) => [w.a.x, w.b.x]));
            const minY = Math.min(...group.flatMap((w) => [w.a.y, w.b.y]));
            const maxY = Math.max(...group.flatMap((w) => [w.a.y, w.b.y]));
            if (maxX - minX < 400 && maxY - minY < 400) return null;
            const gap = 700;
            const topY = minY - gap;
            const leftX = minX - gap;
            return (
              <Group key={`dims-${gi}`} listening={false}>
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
          })}

          {/* Openings */}
          {doc.openings.map((o) => {
            const wall = findWall(doc, o.wallId);
            if (!wall) return null;
            const effective = openingDraft && o.id === openingDraft.id ? { ...o, offsetMm: openingDraft.offsetMm } : o;
            return <OpeningShape key={o.id} wall={wall} opening={effective} selected={selectedIds.includes(o.id)} doc={doc} planMode={planMode} />;
          })}

          {/* Furniture symbols — non-interactive; selection + drag come from
              the Stage-level geometric pipeline. `off` is the live preview. */}
          {showFurniture &&
            doc.symbols.map((sym) => {
              const off = manualOffset(sym.id);
              // Live resize preview takes priority over a move offset.
              let base = symbolResizeDraft?.id === sym.id ? symbolResizeDraft : sym;
              if (symbolRotateDraft?.id === sym.id) base = { ...base, rotationDeg: symbolRotateDraft.deg };
              return (
                <SymbolNode
                  key={sym.id}
                  sym={off.x || off.y ? { ...base, x: base.x + off.x, y: base.y + off.y } : base}
                  selected={selectedIds.includes(sym.id)}
                />
              );
            })}

          {/* Text labels — non-interactive; selection + drag via the
              Stage-level geometric pipeline. `off` is the live preview. */}
          {doc.labels.map((label) => {
            const off = manualOffset(label.id);
            const ls = (labelScaleDraft?.id === label.id ? labelScaleDraft.scale : label.scale) ?? 1;
            return (
              <Text
                key={label.id}
                x={label.x + off.x}
                y={label.y + off.y}
                text={label.text}
                fontSize={(label.heading ? 400 : 220) * ls}
                fontFamily={SANS}
                fontStyle={label.heading ? '700' : '600'}
                fill={selectedIds.includes(label.id) ? ACTION : INK}
                align="center"
                offsetX={label.text.length * (label.heading ? 100 : 55) * ls}
                listening={false}
              />
            );
          })}

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
          {/* "Detect rooms from walls" hover preview — light blue wash over
              every enclosed area that would become a room if clicked. */}
          {detectPreview &&
            detectPreviewRooms.map((r) => (
              <Rect
                key={`dp-${r.id}`}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill="rgba(96,141,222,0.22)"
                stroke="#608DDE"
                strokeWidth={18}
                dash={[140, 100]}
                listening={false}
              />
            ))}

          {/* Smart-snap alignment guides: dashed lines through the wall
              corner the pending point is axis-aligned with. */}
          {tool === 'wall' && alignGuides && hoverPt && (
            <Group listening={false}>
              {alignGuides.x !== null && (
                <Line
                  points={[alignGuides.x, hoverPt.y - 60000, alignGuides.x, hoverPt.y + 60000]}
                  stroke="#D9482F"
                  strokeWidth={14}
                  dash={[130, 130]}
                />
              )}
              {alignGuides.y !== null && (
                <Line
                  points={[hoverPt.x - 60000, alignGuides.y, hoverPt.x + 60000, alignGuides.y]}
                  stroke="#D9482F"
                  strokeWidth={14}
                  dash={[130, 130]}
                />
              )}
            </Group>
          )}
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

          {/* Shaped-room (L/T/U/polygon) draft preview */}
          {tool === 'room' && polyDraft && polyDraft.length > 0 && (
            <>
              <Line
                points={[...polyDraft, ...(hoverPt ? [hoverPt] : [])].flatMap((p) => [p.x, p.y])}
                closed={polyDraft.length + (hoverPt ? 1 : 0) >= 3}
                fill={polyDraft.length >= 2 ? SELECT_FILL : undefined}
                stroke={ACTION}
                strokeWidth={26}
                dash={[120, 80]}
                listening={false}
              />
              {polyDraft.map((p, i) => (
                <Circle
                  key={i}
                  x={p.x}
                  y={p.y}
                  radius={i === 0 ? 130 : 90}
                  fill={i === 0 ? ACTION : '#FFFFFF'}
                  stroke={ACTION}
                  strokeWidth={26}
                  listening={false}
                />
              ))}
            </>
          )}

          {/* Resize handles for the selected room */}
          {selectedRoom && !selectedRoom.polygon && tool === 'select' && renderResizeHandles(selectedRoom)}

          {/* Endpoint drag handles for the selected wall */}
          {selectedWall && tool === 'select' && renderWallEndHandles(selectedWall)}

          {/* Corner resize handles for the selected furniture */}
          {selectedSymbol && showFurniture && tool === 'select' && renderSymbolResizeHandles(selectedSymbol)}

          {/* Rotation handle for the selected furniture */}
          {selectedSymbol && showFurniture && tool === 'select' && renderSymbolRotateHandle(selectedSymbol)}

          {/* Font-size handle for the selected room's label / a text label */}
          {selectedRoom && !selectedRoom.type.includes('Stairs') && tool === 'select' && renderRoomLabelHandle(selectedRoom)}
          {selectedLabel && tool === 'select' && renderTextLabelHandle(selectedLabel)}
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

        {planMode === 'presentation' && zonesPresent.length > 0 && viewport.width >= 640 && (
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
                <span style={{ fontSize: 11.5, fontWeight: 600, color: INK }}>{roomTypeLabel(type)}</span>
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
