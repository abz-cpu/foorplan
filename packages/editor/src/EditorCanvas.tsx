import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Group, Label, Layer, Line, Rect, Stage, Tag, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  addRoom,
  addWall,
  DEFAULT_CEILING_HEIGHT_M,
  DEFAULT_WALL_THICKNESS_MM,
  distance,
  formatAreaM2,
  formatDims,
  formatMmAsM,
  newId,
  roomAreaM2,
  snapPointToGrid,
  snapWallEnd,
  updateRoom,
  wallEndpoints,
  type Point,
  type RoomRect,
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
import { useEditorStore } from './store';

/* Canvas drawing palette — matches the design drafts. */
const WALL = '#1F312C';
const ACTION = '#0B7A5E';
const SELECT_FILL = 'rgba(11,122,94,0.08)';
const ROOM_EDGE = '#D8E1DD';
const INK = '#22332F';
const FAINT = '#71827C';
const SANS = "'Instrument Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function EditorCanvas({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const doc = useEditorStore((s) => s.doc);
  const tool = useEditorStore((s) => s.tool);
  const selectedId = useEditorStore((s) => s.selectedId);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const viewport = useEditorStore((s) => s.viewport);
  const select = useEditorStore((s) => s.select);
  const commit = useEditorStore((s) => s.commit);
  const setView = useEditorStore((s) => s.setView);
  const setPan = useEditorStore((s) => s.setPan);
  const setViewport = useEditorStore((s) => s.setViewport);

  const scale = BASE_PX_PER_MM * zoom;

  /* Draft interaction state */
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [hoverPt, setHoverPt] = useState<Point | null>(null);
  const [roomDraft, setRoomDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [resizeDraft, setResizeDraft] = useState<RoomRect | null>(null);
  const panDrag = useRef<{ pointer: Point; pan: Point } | null>(null);
  const pinch = useRef<{ dist: number; center: Point } | null>(null);

  /* Track container size */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  /* Reset drafts when the tool changes */
  useEffect(() => {
    setWallStart(null);
    setHoverPt(null);
    setRoomDraft(null);
    setResizeDraft(null);
  }, [tool]);

  /* Escape cancels drafts and selection */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setWallStart(null);
      setHoverPt(null);
      setRoomDraft(null);
      setResizeDraft(null);
      select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

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
        endpoints: wallEndpoints(doc),
        endpointToleranceMm: ENDPOINT_TOLERANCE_PX / scale,
        orthoToleranceDeg: snapEnabled ? 7 : 0,
      }),
    [doc, scale, snapEnabled],
  );

  const snapFree = useCallback(
    (raw: Point): Point => (snapEnabled ? snapPointToGrid(raw, GRID_MM) : raw),
    [snapEnabled],
  );

  /* ---- shared pointer logic (mouse + single touch) ---- */

  const pointerDown = (isStageTarget: boolean, screen: Point) => {
    if (tool === 'select' && isStageTarget) {
      panDrag.current = { pointer: screen, pan };
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
    } else if (tool === 'room') {
      const a = snapFree(raw);
      setRoomDraft({ a, b: a });
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
    if (tool === 'wall') {
      const raw = pointerWorld();
      if (raw) setHoverPt(snapEnd(raw, wallStart));
    } else if (tool === 'room' && roomDraft) {
      const raw = pointerWorld();
      if (raw) setRoomDraft({ a: roomDraft.a, b: snapFree(raw) });
    }
  };

  const pointerUp = () => {
    panDrag.current = null;
    if (tool === 'room' && roomDraft) {
      const x = Math.min(roomDraft.a.x, roomDraft.b.x);
      const y = Math.min(roomDraft.a.y, roomDraft.b.y);
      const w = Math.abs(roomDraft.b.x - roomDraft.a.x);
      const h = Math.abs(roomDraft.b.y - roomDraft.a.y);
      if (w >= MIN_ROOM_MM && h >= MIN_ROOM_MM) {
        const room: RoomRect = {
          id: newId(),
          x,
          y,
          w,
          h,
          name: `Room ${doc.rooms.length + 1}`,
          type: 'Other',
          ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
          includeInGia: true,
        };
        commit('Add room', addRoom(doc, room));
        select(room.id);
      }
      setRoomDraft(null);
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
      setRoomDraft(null);
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

  const roomDraftRect = roomDraft
    ? {
        x: Math.min(roomDraft.a.x, roomDraft.b.x),
        y: Math.min(roomDraft.a.y, roomDraft.b.y),
        w: Math.abs(roomDraft.b.x - roomDraft.a.x),
        h: Math.abs(roomDraft.b.y - roomDraft.a.y),
      }
    : null;

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
        background: '#FBFDFC',
        backgroundImage: 'radial-gradient(#DCE6E2 1px, transparent 1px)',
        backgroundSize: `${DISPLAY_GRID_MM * scale}px ${DISPLAY_GRID_MM * scale}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: tool === 'select' ? 'default' : 'crosshair',
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
          {/* Rooms */}
          {doc.rooms.map((room) => {
            const r = resizeDraft?.id === room.id ? resizeDraft : room;
            const isSel = selectedId === room.id;
            return (
              <Group
                key={room.id}
                x={r.x}
                y={r.y}
                draggable={tool === 'select' && !resizeDraft}
                onClick={() => tool === 'select' && select(room.id)}
                onTap={() => tool === 'select' && select(room.id)}
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
              </Group>
            );
          })}

          {/* Walls */}
          {doc.walls.map((w) => {
            const isSel = selectedId === w.id;
            return (
              <Line
                key={w.id}
                points={[w.a.x, w.a.y, w.b.x, w.b.y]}
                stroke={isSel ? ACTION : WALL}
                strokeWidth={w.thickness}
                lineCap="square"
                hitStrokeWidth={Math.max(w.thickness, 320)}
                onClick={() => tool === 'select' && select(w.id)}
                onTap={() => tool === 'select' && select(w.id)}
              />
            );
          })}

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

          {/* Room draft preview */}
          {roomDraftRect && roomDraftRect.w > 0 && roomDraftRect.h > 0 && (
            <>
              <Rect
                x={roomDraftRect.x}
                y={roomDraftRect.y}
                width={roomDraftRect.w}
                height={roomDraftRect.h}
                fill={SELECT_FILL}
                stroke={ACTION}
                strokeWidth={26}
                dash={[120, 80]}
                listening={false}
              />
              <Label
                x={roomDraftRect.x + roomDraftRect.w / 2}
                y={roomDraftRect.y - 380}
                listening={false}
              >
                <Tag fill="#FFFFFF" opacity={0.94} cornerRadius={90} />
                <Text
                  text={formatDims(roomDraftRect.w, roomDraftRect.h)}
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
