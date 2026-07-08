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
  DEFAULT_WINDOW_WIDTH_MM,
  distance,
  findWall,
  formatAreaM2,
  formatDims,
  formatMmAsM,
  nearestOffsetOnWall,
  nearestWall,
  newId,
  openingJambs,
  roomAreaM2,
  snapPointToGrid,
  snapValueToGrid,
  snapWallEnd,
  SYMBOL_DEFS,
  updateLabel,
  updateOpening,
  updateRoom,
  updateSymbol,
  wallNormal,
  wallSegments,
  type Opening,
  type Point,
  type RoomRect,
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

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const isDraftingTool = (t: Tool) => t === 'room' || t === 'stairs';

/** Furniture symbol rendered from its unit-box primitives inside a rotatable group. */
function SymbolNode({
  sym,
  selected,
  draggable,
  onSelect,
  onMove,
}: {
  sym: SymbolInstance;
  selected: boolean;
  draggable: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (x: number, y: number) => void;
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
      onDragStart={() => onSelect(false)}
      onDragEnd={(e) => onMove(e.target.x() - sym.w / 2, e.target.y() - sym.h / 2)}
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
  const spacing = 280;
  const treads: number[] = [];
  if (horizontal) {
    for (let x = spacing; x < room.w - 40; x += spacing) treads.push(x);
  } else {
    for (let y = spacing; y < room.h - 40; y += spacing) treads.push(y);
  }
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
          <Line points={[120, room.h / 2, room.w - 200, room.h / 2]} stroke={INK} strokeWidth={22} listening={false} />
          <Line
            points={[room.w - 320, room.h / 2 - 110, room.w - 200, room.h / 2, room.w - 320, room.h / 2 + 110]}
            stroke={INK}
            strokeWidth={22}
            listening={false}
          />
        </>
      ) : (
        <>
          <Line points={[room.w / 2, 120, room.w / 2, room.h - 200]} stroke={INK} strokeWidth={22} listening={false} />
          <Line
            points={[room.w / 2 - 110, room.h - 320, room.w / 2, room.h - 200, room.w / 2 + 110, room.h - 320]}
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
    const hinge = opening.hinge === 'left' ? start : end;
    const jamb = opening.hinge === 'left' ? end : start;
    const tip = { x: hinge.x + n.x * opening.widthMm, y: hinge.y + n.y * opening.widthMm };
    const startDeg = (Math.atan2(jamb.y - hinge.y, jamb.x - hinge.x) * 180) / Math.PI;
    const endDeg = (Math.atan2(tip.y - hinge.y, tip.x - hinge.x) * 180) / Math.PI;
    let delta = endDeg - startDeg;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
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

  const doc = useEditorStore((s) => s.doc);
  const tool = useEditorStore((s) => s.tool);
  const symbolKind = useEditorStore((s) => s.symbolKind);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const viewport = useEditorStore((s) => s.viewport);
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
  const [openingHover, setOpeningHover] = useState<{ wall: Wall; offsetMm: number } | null>(null);
  const [openingDraft, setOpeningDraft] = useState<{ id: string; offsetMm: number } | null>(null);
  const [measureA, setMeasureA] = useState<Point | null>(null);
  const [underlayImg, setUnderlayImg] = useState<HTMLImageElement | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
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

  const snapFree = useCallback(
    (raw: Point): Point => (snapEnabled ? snapPointToGrid(raw, GRID_MM) : raw),
    [snapEnabled],
  );

  const wallHitToleranceMm = 24 / scale;

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
          addWall(doc, { id: newId(), a: wallStart, b: pt, thickness: DEFAULT_WALL_THICKNESS_MM }),
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
      const opening: Opening = {
        id: newId(),
        wallId: hit.wall.id,
        kind: tool,
        offsetMm: offset,
        widthMm: width,
        hinge: 'left',
      };
      commit(tool === 'door' ? 'Place door' : 'Place window', addOpening(doc, opening));
      select(opening.id);
      setOpeningHover(null);
    } else if (tool === 'symbol') {
      const def = SYMBOL_DEFS[symbolKind];
      const centre = snapFree(raw);
      const sym: SymbolInstance = {
        id: newId(),
        kind: symbolKind,
        x: centre.x - def.w / 2,
        y: centre.y - def.h / 2,
        w: def.w,
        h: def.h,
        rotationDeg: 0,
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
        selectMany(entitiesInRect(marqueeDraft.a, marqueeDraft.b));
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

  /* ---- render helpers ---- */

  const selectedRoom = doc.rooms.find((r) => r.id === selectedId) ?? null;
  const handleHalf = 5 / scale; // 10px squares on screen

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
        backgroundImage: 'radial-gradient(#DCE6E2 1px, transparent 1px)',
        backgroundSize: `${DISPLAY_GRID_MM * scale}px ${DISPLAY_GRID_MM * scale}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor:
          tool === 'select'
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
          endWallChain();
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

          {/* Rooms (incl. stairs) */}
          {doc.rooms.map((room) => {
            const r = resizeDraft?.id === room.id ? resizeDraft : room;
            const isSel = selectedIds.includes(room.id);
            const stairs = room.type === 'Stairs';
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
                onDragStart={() => select(room.id)}
                onDragEnd={(e) => {
                  const snapped = snapFree({ x: e.target.x(), y: e.target.y() });
                  e.target.position(snapped);
                  commit('Move room', updateRoom(doc, room.id, { x: snapped.x, y: snapped.y }));
                }}
              >
                <Rect
                  width={r.w}
                  height={r.h}
                  fill={isSel ? SELECT_FILL : '#FFFFFF'}
                  stroke={isSel ? ACTION : ROOM_EDGE}
                  strokeWidth={isSel ? 34 : 18}
                  dash={isSel ? [110, 75] : undefined}
                />
                {stairs ? (
                  <StairsTreads room={r} />
                ) : (
                  <>
                    <Text
                      text={r.name}
                      width={r.w}
                      y={r.h / 2 - 320}
                      align="center"
                      fontSize={260}
                      fontFamily={SANS}
                      fontStyle="600"
                      fill={INK}
                      listening={false}
                    />
                    <Text
                      text={formatAreaM2(roomAreaM2(r))}
                      width={r.w}
                      y={r.h / 2 + 60}
                      align="center"
                      fontSize={185}
                      fontFamily={MONO}
                      fill={FAINT}
                      listening={false}
                    />
                  </>
                )}
              </Group>
            );
          })}

          {/* Walls (cut around openings) */}
          {doc.walls.map((w) => {
            const isSel = selectedIds.includes(w.id);
            const openings = doc.openings.map((o) =>
              openingDraft && o.id === openingDraft.id ? { ...o, offsetMm: openingDraft.offsetMm } : o,
            );
            return wallSegments(w, openings).map((seg, i) => (
              <Line
                key={`${w.id}-${i}`}
                points={[seg.a.x, seg.a.y, seg.b.x, seg.b.y]}
                stroke={isSel ? ACTION : WALL}
                strokeWidth={w.thickness}
                lineCap="square"
                hitStrokeWidth={Math.max(w.thickness, 320)}
                onClick={(e) => {
                  if (tool !== 'select') return;
                  const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
                  if (additive) toggleSelect(w.id, true);
                  else select(w.id);
                }}
                onTap={() => tool === 'select' && select(w.id)}
              />
            ));
          })}

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
          {doc.symbols.map((sym) => (
            <SymbolNode
              key={sym.id}
              sym={sym}
              selected={selectedIds.includes(sym.id)}
              draggable={tool === 'select'}
              onSelect={(additive) => {
                if (tool !== 'select') return;
                if (additive) toggleSelect(sym.id, true);
                else select(sym.id);
              }}
              onMove={(x, y) => {
                const snapped = snapFree({ x, y });
                commit('Move symbol', updateSymbol(doc, sym.id, { x: snapped.x, y: snapped.y }));
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
              onDragStart={() => select(label.id)}
              onDragEnd={(e) =>
                commit('Move label', updateLabel(doc, label.id, { x: e.target.x(), y: e.target.y() }))
              }
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
          {tool === 'wall' && wallStart && hoverPt && (
            <>
              <Line
                points={[wallStart.x, wallStart.y, hoverPt.x, hoverPt.y]}
                stroke={ACTION}
                strokeWidth={DEFAULT_WALL_THICKNESS_MM}
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
                  text={formatMmAsM(distance(wallStart, hoverPt))}
                  fontSize={210}
                  fontFamily={MONO}
                  fill={ACTION}
                  padding={80}
                />
              </Label>
            </>
          )}

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
        </Layer>
      </Stage>
    </div>
  );
}
