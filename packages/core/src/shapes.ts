import { docBounds, roomAreaM2 } from './geometry';
import { doorSwingGeometry, openingJambs, wallNormal, wallSegments } from './openings';
import { formatAreaM2, formatMmAsM } from './format';
import { SYMBOL_DEFS, type SymbolInstance } from './symbols';
import type { FloorDoc, Opening, Point, RoomRect, RoomType, TextLabel, Wall } from './types';

/**
 * Renderer-agnostic display list. All coordinates in world millimetres.
 * Consumed by thin backends: SVG string, Canvas2D, and PDF.
 */
export type Shape =
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      width: number;
      cap?: 'butt' | 'square' | 'round';
      dash?: number[];
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      r: number;
      startDeg: number;
      endDeg: number;
      anticlockwise: boolean;
      stroke: string;
      width: number;
    }
  | { kind: 'polyline'; points: Point[]; stroke: string; width: number }
  | {
      kind: 'text';
      x: number;
      y: number; // baseline
      text: string;
      size: number;
      color: string;
      font: 'sans' | 'mono';
      weight?: number;
      align?: 'left' | 'center' | 'right';
      rotateDeg?: number;
    };

export interface DocShapesOptions {
  showDims?: boolean;
  showLabels?: boolean;
  /** 'presentation' shades each room's fill by type (ROOM_ZONE_COLORS)
   *  instead of plain white, matching the editor's Presentation plan mode
   *  so an exported sheet looks the same as what was on screen. */
  planMode?: 'technical' | 'presentation';
}

const WALL = '#1F312C';
const WALL_LIGHT = '#4A5D57';
const ROOM_EDGE = '#D8E1DD';
const INK = '#22332F';
const FAINT = '#71827C';
const DIM = '#4A5D57';
const DIM_LINE = '#7C9A90';

/** Presentation-mode zonal shading — one soft fill/edge pair per room type,
 *  used instead of the plain white technical-drawing fill. Shared by the
 *  editor canvas and every export backend so they can never drift apart. */
export const ROOM_ZONE_COLORS: Record<RoomType, { fill: string; edge: string }> = {
  'Living Room': { fill: '#E4EEE8', edge: '#9DBFAC' },
  'Kitchen / Diner': { fill: '#FBEED9', edge: '#E0B871' },
  Bedroom: { fill: '#E3EAF7', edge: '#9FB4DE' },
  Bathroom: { fill: '#DFF1F0', edge: '#8FC9C5' },
  WC: { fill: '#E8F1EF', edge: '#A9CAC4' },
  Hallway: { fill: '#EEECE6', edge: '#C3BCAC' },
  Stairs: { fill: '#EAE3F2', edge: '#B9A4D1' },
  Utility: { fill: '#F0E8E1', edge: '#CBAF98' },
  Other: { fill: '#EDEDED', edge: '#C6C6C6' },
};

function roomShapes(room: RoomRect, showLabels: boolean, planMode: 'technical' | 'presentation'): Shape[] {
  const zone = planMode === 'presentation' ? ROOM_ZONE_COLORS[room.type] : null;
  const shapes: Shape[] = [
    {
      kind: 'rect',
      x: room.x,
      y: room.y,
      w: room.w,
      h: room.h,
      fill: zone?.fill ?? '#FFFFFF',
      stroke: zone?.edge ?? ROOM_EDGE,
      strokeWidth: 18,
    },
  ];

  if (room.type === 'Stairs') {
    // Treads across the short axis, direction arrow along the long axis.
    // Mirrors EditorCanvas.tsx's StairsTreads exactly so the exported plan
    // always matches what was drawn in the editor, including a flipped
    // stairDirection.
    const horizontal = room.w >= room.h;
    const reversed = room.stairDirection === 'reversed';
    const spacing = 280;
    const dim = horizontal ? room.w : room.h;
    const shaftFrom = reversed ? dim - 120 : 120;
    const shaftTo = reversed ? 200 : dim - 200;
    const wingBack = reversed ? shaftTo + 120 : shaftTo - 120;
    if (horizontal) {
      for (let x = room.x + spacing; x < room.x + room.w - 40; x += spacing) {
        shapes.push({ kind: 'line', x1: x, y1: room.y, x2: x, y2: room.y + room.h, stroke: WALL_LIGHT, width: 16 });
      }
      const midY = room.y + room.h / 2;
      shapes.push({
        kind: 'line',
        x1: room.x + shaftFrom,
        y1: midY,
        x2: room.x + shaftTo,
        y2: midY,
        stroke: INK,
        width: 22,
      });
      shapes.push({
        kind: 'polyline',
        points: [
          { x: room.x + wingBack, y: midY - 110 },
          { x: room.x + shaftTo, y: midY },
          { x: room.x + wingBack, y: midY + 110 },
        ],
        stroke: INK,
        width: 22,
      });
    } else {
      for (let y = room.y + spacing; y < room.y + room.h - 40; y += spacing) {
        shapes.push({ kind: 'line', x1: room.x, y1: y, x2: room.x + room.w, y2: y, stroke: WALL_LIGHT, width: 16 });
      }
      const midX = room.x + room.w / 2;
      shapes.push({
        kind: 'line',
        x1: midX,
        y1: room.y + shaftFrom,
        x2: midX,
        y2: room.y + shaftTo,
        stroke: INK,
        width: 22,
      });
      shapes.push({
        kind: 'polyline',
        points: [
          { x: midX - 110, y: room.y + wingBack },
          { x: midX, y: room.y + shaftTo },
          { x: midX + 110, y: room.y + wingBack },
        ],
        stroke: INK,
        width: 22,
      });
    }
    // Stairs are a pure visual asset — no name/area/height label (the
    // treads already read as "stairs"; height lives on the room labels).
    return shapes;
  }

  if (showLabels) {
    // Honour a dragged label position so the export matches the canvas.
    const cx = room.x + room.w / 2 + (room.labelOffset?.x ?? 0);
    const cy = room.y + room.h / 2 + (room.labelOffset?.y ?? 0);
    shapes.push({
      kind: 'text',
      x: cx,
      y: cy - 60,
      text: room.name,
      size: 260,
      color: INK,
      font: 'sans',
      weight: 600,
      align: 'center',
    });
    shapes.push({
      kind: 'text',
      x: cx,
      y: cy + 240,
      text: `${formatAreaM2(roomAreaM2(room))} · ${room.ceilingHeightM.toFixed(2)}m`,
      size: 185,
      color: FAINT,
      font: 'mono',
      align: 'center',
    });
  }
  return shapes;
}

function openingShapes(wall: Wall, opening: Opening): Shape[] {
  const { start, end } = openingJambs(wall, opening);
  const n = wallNormal(wall);
  const t = wall.thickness;

  if (opening.kind === 'window') {
    // Double-line window across the gap + jamb caps.
    const off = t * 0.28;
    const shapes: Shape[] = [];
    for (const s of [off, -off]) {
      shapes.push({
        kind: 'line',
        x1: start.x + n.x * s,
        y1: start.y + n.y * s,
        x2: end.x + n.x * s,
        y2: end.y + n.y * s,
        stroke: WALL,
        width: 22,
      });
    }
    for (const p of [start, end]) {
      shapes.push({
        kind: 'line',
        x1: p.x + n.x * (t / 2),
        y1: p.y + n.y * (t / 2),
        x2: p.x - n.x * (t / 2),
        y2: p.y - n.y * (t / 2),
        stroke: WALL,
        width: 22,
      });
    }
    return shapes;
  }

  // Door: leaf at the hinge jamb + quarter swing arc to the other jamb.
  const { hinge, tip, startDeg, endDeg, delta } = doorSwingGeometry(wall, opening);
  return [
    { kind: 'line', x1: hinge.x, y1: hinge.y, x2: tip.x, y2: tip.y, stroke: WALL_LIGHT, width: 25 },
    {
      kind: 'arc',
      cx: hinge.x,
      cy: hinge.y,
      r: opening.widthMm,
      startDeg,
      endDeg,
      anticlockwise: delta < 0,
      stroke: WALL_LIGHT,
      width: 20,
    },
  ];
}

/**
 * Flatten a symbol instance's unit-box primitives into world-space shapes,
 * applying scale then rotation about the footprint centre. Emitting plain
 * lines/arcs/polylines keeps every backend (SVG/canvas/PDF/Konva) trivial.
 */
export function symbolToShapes(sym: SymbolInstance, stroke = WALL_LIGHT, width = 20): Shape[] {
  const def = SYMBOL_DEFS[sym.kind];
  const sx = sym.w / 100;
  const sy = sym.h / 100;
  const mirrored = sym.mirrored ?? false;
  const cx = sym.x + sym.w / 2;
  const cy = sym.y + sym.h / 2;
  const theta = (sym.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tp = (ux: number, uy: number): Point => {
    // mirror in local space, then scale into footprint, then rotate about centre
    const localX = mirrored ? 100 - ux : ux;
    const px = sym.x + localX * sx;
    const py = sym.y + uy * sy;
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  const shapes: Shape[] = [];
  for (const p of def.prims) {
    if (p.t === 'line') {
      const a = tp(p.x1, p.y1);
      const b = tp(p.x2, p.y2);
      shapes.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke, width });
    } else if (p.t === 'rect') {
      const pts = [
        tp(p.x, p.y),
        tp(p.x + p.w, p.y),
        tp(p.x + p.w, p.y + p.h),
        tp(p.x, p.y + p.h),
        tp(p.x, p.y),
      ];
      shapes.push({ kind: 'polyline', points: pts, stroke, width });
    } else {
      const c = tp(p.cx, p.cy);
      const r = p.r * Math.min(sx, sy);
      shapes.push({
        kind: 'arc',
        cx: c.x,
        cy: c.y,
        r,
        startDeg: 0,
        endDeg: 359.99,
        anticlockwise: false,
        stroke,
        width,
      });
    }
  }
  return shapes;
}

function labelShapes(label: TextLabel): Shape[] {
  return [
    {
      kind: 'text',
      x: label.x,
      y: label.y,
      text: label.text,
      size: 220,
      color: INK,
      font: 'sans',
      weight: 600,
      align: 'center',
    },
  ];
}

function dimensionShapes(doc: FloorDoc): Shape[] {
  const bounds = docBounds(doc);
  if (!bounds) return [];
  const { minX, minY, maxX, maxY } = bounds;
  const shapes: Shape[] = [];
  const tick = 180;
  const gap = 320;

  // Top: overall width
  const yTop = minY - gap;
  shapes.push(
    { kind: 'line', x1: minX, y1: yTop - tick / 2, x2: minX, y2: yTop + tick / 2, stroke: DIM_LINE, width: 16 },
    { kind: 'line', x1: maxX, y1: yTop - tick / 2, x2: maxX, y2: yTop + tick / 2, stroke: DIM_LINE, width: 16 },
    { kind: 'line', x1: minX, y1: yTop, x2: maxX, y2: yTop, stroke: DIM_LINE, width: 16 },
    {
      kind: 'text',
      x: (minX + maxX) / 2,
      y: yTop - 120,
      text: formatMmAsM(maxX - minX),
      size: 200,
      color: DIM,
      font: 'mono',
      align: 'center',
    },
  );

  // Left: overall height (rotated label)
  const xLeft = minX - gap;
  shapes.push(
    { kind: 'line', x1: xLeft - tick / 2, y1: minY, x2: xLeft + tick / 2, y2: minY, stroke: DIM_LINE, width: 16 },
    { kind: 'line', x1: xLeft - tick / 2, y1: maxY, x2: xLeft + tick / 2, y2: maxY, stroke: DIM_LINE, width: 16 },
    { kind: 'line', x1: xLeft, y1: minY, x2: xLeft, y2: maxY, stroke: DIM_LINE, width: 16 },
    {
      kind: 'text',
      x: xLeft - 120,
      y: (minY + maxY) / 2,
      text: formatMmAsM(maxY - minY),
      size: 200,
      color: DIM,
      font: 'mono',
      align: 'center',
      rotateDeg: -90,
    },
  );
  return shapes;
}

/** Flatten a floor document into ordered drawing primitives (world mm). */
export function docToShapes(doc: FloorDoc, options: DocShapesOptions = {}): Shape[] {
  const { showDims = true, showLabels = true, planMode = 'technical' } = options;
  const shapes: Shape[] = [];

  // Largest-area first so a smaller nested room (e.g. stairs inside a
  // hallway) always draws on top instead of being covered by — or
  // covering the label of — the bigger room it sits inside.
  const roomsByAreaDesc = [...doc.rooms].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const room of roomsByAreaDesc) shapes.push(...roomShapes(room, showLabels, planMode));

  for (const wall of doc.walls) {
    for (const seg of wallSegments(wall, doc.openings)) {
      shapes.push({
        kind: 'line',
        x1: seg.a.x,
        y1: seg.a.y,
        x2: seg.b.x,
        y2: seg.b.y,
        stroke: WALL,
        width: wall.thickness,
        cap: 'square',
      });
    }
  }

  for (const opening of doc.openings) {
    const wall = doc.walls.find((w) => w.id === opening.wallId);
    if (wall) shapes.push(...openingShapes(wall, opening));
  }

  for (const sym of doc.symbols) shapes.push(...symbolToShapes(sym));
  if (showLabels) for (const label of doc.labels) shapes.push(...labelShapes(label));

  if (showDims) shapes.push(...dimensionShapes(doc));
  return shapes;
}

/** Scale + translate every shape (including stroke widths and text sizes). */
export function transformShapes(shapes: Shape[], scale: number, dx: number, dy: number): Shape[] {
  const sx = (x: number) => x * scale + dx;
  const sy = (y: number) => y * scale + dy;
  return shapes.map((s): Shape => {
    switch (s.kind) {
      case 'line':
        return {
          ...s,
          x1: sx(s.x1),
          y1: sy(s.y1),
          x2: sx(s.x2),
          y2: sy(s.y2),
          width: s.width * scale,
          dash: s.dash?.map((d) => d * scale),
        };
      case 'rect':
        return {
          ...s,
          x: sx(s.x),
          y: sy(s.y),
          w: s.w * scale,
          h: s.h * scale,
          strokeWidth: s.strokeWidth !== undefined ? s.strokeWidth * scale : undefined,
        };
      case 'arc':
        return { ...s, cx: sx(s.cx), cy: sy(s.cy), r: s.r * scale, width: s.width * scale };
      case 'polyline':
        return {
          ...s,
          points: s.points.map((p) => ({ x: sx(p.x), y: sy(p.y) })),
          width: s.width * scale,
        };
      case 'text':
        return { ...s, x: sx(s.x), y: sy(s.y), size: s.size * scale };
    }
  });
}
