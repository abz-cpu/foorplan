import { docBounds, roomAreaM2 } from './geometry';
import { openingJambs, wallNormal, wallSegments } from './openings';
import { formatAreaM2, formatMmAsM } from './format';
import { SYMBOL_DEFS, type SymbolInstance } from './symbols';
import type { FloorDoc, Opening, Point, RoomRect, TextLabel, Wall } from './types';

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
}

const WALL = '#1F312C';
const WALL_LIGHT = '#4A5D57';
const ROOM_EDGE = '#D8E1DD';
const INK = '#22332F';
const FAINT = '#71827C';
const DIM = '#4A5D57';
const DIM_LINE = '#7C9A90';

const deg = (from: Point, to: Point) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

function roomShapes(room: RoomRect, showLabels: boolean): Shape[] {
  const shapes: Shape[] = [
    {
      kind: 'rect',
      x: room.x,
      y: room.y,
      w: room.w,
      h: room.h,
      fill: '#FFFFFF',
      stroke: ROOM_EDGE,
      strokeWidth: 18,
    },
  ];

  if (room.type === 'Stairs') {
    // Treads across the short axis, direction arrow along the long axis.
    const horizontal = room.w >= room.h;
    const spacing = 280;
    if (horizontal) {
      for (let x = room.x + spacing; x < room.x + room.w - 40; x += spacing) {
        shapes.push({ kind: 'line', x1: x, y1: room.y, x2: x, y2: room.y + room.h, stroke: WALL_LIGHT, width: 16 });
      }
      const midY = room.y + room.h / 2;
      shapes.push({ kind: 'line', x1: room.x + 120, y1: midY, x2: room.x + room.w - 200, y2: midY, stroke: INK, width: 22 });
      shapes.push({
        kind: 'polyline',
        points: [
          { x: room.x + room.w - 320, y: midY - 110 },
          { x: room.x + room.w - 200, y: midY },
          { x: room.x + room.w - 320, y: midY + 110 },
        ],
        stroke: INK,
        width: 22,
      });
    } else {
      for (let y = room.y + spacing; y < room.y + room.h - 40; y += spacing) {
        shapes.push({ kind: 'line', x1: room.x, y1: y, x2: room.x + room.w, y2: y, stroke: WALL_LIGHT, width: 16 });
      }
      const midX = room.x + room.w / 2;
      shapes.push({ kind: 'line', x1: midX, y1: room.y + 120, x2: midX, y2: room.y + room.h - 200, stroke: INK, width: 22 });
      shapes.push({
        kind: 'polyline',
        points: [
          { x: midX - 110, y: room.y + room.h - 320 },
          { x: midX, y: room.y + room.h - 200 },
          { x: midX + 110, y: room.y + room.h - 320 },
        ],
        stroke: INK,
        width: 22,
      });
    }
    return shapes;
  }

  if (showLabels) {
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
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
      text: formatAreaM2(roomAreaM2(room)),
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
  const hinge = opening.hinge === 'left' ? start : end;
  const jamb = opening.hinge === 'left' ? end : start;
  const tip = { x: hinge.x + n.x * opening.widthMm, y: hinge.y + n.y * opening.widthMm };
  const startDeg = deg(hinge, jamb);
  const endDeg = deg(hinge, tip);
  let delta = endDeg - startDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
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
  const cx = sym.x + sym.w / 2;
  const cy = sym.y + sym.h / 2;
  const theta = (sym.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tp = (ux: number, uy: number): Point => {
    // scale into footprint, then rotate about centre
    const px = sym.x + ux * sx;
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
  const { showDims = true, showLabels = true } = options;
  const shapes: Shape[] = [];

  for (const room of doc.rooms) shapes.push(...roomShapes(room, showLabels));

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
