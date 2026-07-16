import { docBounds, roomAreaM2, roomPolygon } from './geometry';
import { pointInPolygon } from './faces';
import { resolveRoomLabelOffset } from './labels';
import { doorSwingGeometry, openingJambs, wallNormal } from './openings';
import { wallBodyQuads } from './walljoin';
import { formatArea, formatDims, formatMmAsM, type AreaUnits } from './format';
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
  | {
      kind: 'polyline';
      points: Point[];
      stroke: string;
      width: number;
      /** filled closed polygon when set (rooms with a non-rect outline) */
      fill?: string;
      closed?: boolean;
    }
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
      /** Optional hyperlink — rendered as <a> in SVG and a link annotation
       *  in PDF (ignored in raster PNG/JPG). */
      href?: string;
    }
  | {
      kind: 'image';
      /** top-left, paper-mm */
      x: number;
      y: number;
      w: number;
      h: number;
      /** data: URL (PNG/JPEG) — embedded so export stays fully offline */
      href: string;
    };

export interface DocShapesOptions {
  showDims?: boolean;
  showLabels?: boolean;
  /** 'presentation' shades each room's fill by type (ROOM_ZONE_COLORS)
   *  instead of plain white, matching the editor's Presentation plan mode
   *  so an exported sheet looks the same as what was on screen. */
  planMode?: 'technical' | 'presentation';
  /** Display units for room area labels — m², ft², or both. */
  areaUnits?: AreaUnits;
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
  Lounge: { fill: '#DCEDDA', edge: '#8FBC8A' },
  'Kitchen / Diner': { fill: '#FBEED9', edge: '#E0B871' },
  'Dining Room': { fill: '#F9E3D0', edge: '#DBA377' },
  Bedroom: { fill: '#E3EAF7', edge: '#9FB4DE' },
  Bathroom: { fill: '#DFF1F0', edge: '#8FC9C5' },
  WC: { fill: '#E8F1EF', edge: '#A9CAC4' },
  Hallway: { fill: '#EEECE6', edge: '#C3BCAC' },
  Study: { fill: '#EDE7F4', edge: '#B49FD3' },
  Conservatory: { fill: '#E4F2E0', edge: '#9CC694' },
  Garage: { fill: '#E6E8EA', edge: '#ABB3B9' },
  Porch: { fill: '#F2EEE3', edge: '#CDBF9E' },
  Stairs: { fill: '#EAE3F2', edge: '#B9A4D1' },
  Utility: { fill: '#F0E8E1', edge: '#CBAF98' },
  Other: { fill: '#EDEDED', edge: '#C6C6C6' },
};

function roomShapes(
  room: RoomRect,
  showLabels: boolean,
  planMode: 'technical' | 'presentation',
  labelOffset: Point = { x: 0, y: 0 },
  areaUnits: AreaUnits = 'm2',
): Shape[] {
  const zone = planMode === 'presentation' ? ROOM_ZONE_COLORS[room.type] : null;
  const fill = zone?.fill ?? '#FFFFFF';
  const edge = zone?.edge ?? ROOM_EDGE;
  const shapes: Shape[] =
    room.polygon && room.polygon.length >= 3
      ? [{ kind: 'polyline', points: room.polygon, stroke: edge, width: 18, fill, closed: true }]
      : [{ kind: 'rect', x: room.x, y: room.y, w: room.w, h: room.h, fill, stroke: edge, strokeWidth: 18 }];

  if (room.type === 'Stairs') {
    // Stairs are a pure visual asset — no name/area/height label (the
    // treads already read as "stairs"; height lives on the room labels).
    shapes.push(...stairShapes(room));
    return shapes;
  }

  if (showLabels) {
    // Use the same resolved label position (dragged, else smart auto-placement)
    // the editor canvas uses, so the export matches what was on screen.
    const cx = room.x + room.w / 2 + labelOffset.x;
    const cy = room.y + room.h / 2 + labelOffset.y;
    const areaText = formatArea(roomAreaM2(room), areaUnits);
    const dimsText = formatDims(room.displayWMm ?? room.w, room.displayLMm ?? room.h);
    // Shrink the label block to fit small rooms (a porch, a WC) instead of
    // spilling over their walls into the neighbouring space.
    const k = roomLabelShrink(room, [room.name, areaText, dimsText]);
    shapes.push({
      kind: 'text',
      x: cx,
      y: cy - 130 * k,
      text: room.name,
      size: 260 * k,
      color: INK,
      font: 'sans',
      weight: 600,
      align: 'center',
    });
    shapes.push({
      kind: 'text',
      x: cx,
      y: cy + 155 * k,
      text: areaText,
      size: 185 * k,
      color: FAINT,
      font: 'mono',
      align: 'center',
    });
    // Width × length under the area — agents quote both on listings.
    shapes.push({
      kind: 'text',
      x: cx,
      y: cy + 395 * k,
      text: dimsText,
      size: 160 * k,
      color: FAINT,
      font: 'mono',
      align: 'center',
    });
  }
  return shapes;
}

/** Scale factor (≤1) that fits a room's label block inside its width — the
 *  same rule the canvas uses, so editor and export agree. */
export function roomLabelShrink(room: RoomRect, lines: string[]): number {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const textWidthMm = longest * 150; // ~monospace advance at base size
  const fitW = (room.w * 0.92) / textWidthMm;
  const fitH = (room.h * 0.9) / 900; // three lines ≈ 900mm tall at base size
  return Math.max(0.4, Math.min(1, fitW, fitH)) * (room.labelScale ?? 1);
}

/**
 * The tread/flight graphics for a stairs asset — straight (default), U-turn
 * (switchback with a landing), or spiral. Shared by the editor canvas and
 * every export backend.
 */
export function stairShapes(room: RoomRect): Shape[] {
  const shapes: Shape[] = [];
  const style = room.stairStyle ?? 'straight';
  const spacing = 280;
  const horizontal = room.w >= room.h;
  const reversed = room.stairDirection === 'reversed';

  if (style === 'spiral') {
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const r = Math.max(200, Math.min(room.w, room.h) / 2 - 80);
    shapes.push({ kind: 'arc', cx, cy, r, startDeg: 0, endDeg: 359.99, anticlockwise: false, stroke: WALL_LIGHT, width: 20 });
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      shapes.push({
        kind: 'line',
        x1: cx,
        y1: cy,
        x2: cx + Math.cos(a) * r,
        y2: cy + Math.sin(a) * r,
        stroke: WALL_LIGHT,
        width: 14,
      });
    }
    shapes.push({ kind: 'arc', cx, cy, r: 90, startDeg: 0, endDeg: 359.99, anticlockwise: false, stroke: INK, width: 18 });
    return shapes;
  }

  if (style === 'uturn') {
    // Two flights split across the short axis, landing at the far 22%.
    if (horizontal) {
      const landingW = room.w * 0.22;
      const flightEnd = reversed ? room.x + room.w : room.x + room.w - landingW;
      const flightStart = reversed ? room.x + landingW : room.x;
      const midY = room.y + room.h / 2;
      shapes.push({ kind: 'line', x1: flightStart, y1: midY, x2: flightEnd, y2: midY, stroke: WALL, width: 18 });
      for (let x = flightStart + spacing; x < flightEnd - 40; x += spacing) {
        shapes.push({ kind: 'line', x1: x, y1: room.y, x2: x, y2: midY, stroke: WALL_LIGHT, width: 16 });
        shapes.push({ kind: 'line', x1: x, y1: midY, x2: x, y2: room.y + room.h, stroke: WALL_LIGHT, width: 16 });
      }
      // U arrow: up one flight, around the landing, back the other
      const ax0 = reversed ? room.x + room.w - 200 : room.x + 200;
      const ax1 = reversed ? room.x + landingW * 0.55 : room.x + room.w - landingW * 0.55;
      const y1 = room.y + room.h * 0.25;
      const y2 = room.y + room.h * 0.75;
      shapes.push({
        kind: 'polyline',
        points: [
          { x: ax0, y: y1 },
          { x: ax1, y: y1 },
          { x: ax1, y: y2 },
          { x: ax0, y: y2 },
        ],
        stroke: INK,
        width: 20,
      });
      const wing = reversed ? -110 : 110;
      shapes.push({
        kind: 'polyline',
        points: [
          { x: ax0 + wing, y: y2 - 110 },
          { x: ax0, y: y2 },
          { x: ax0 + wing, y: y2 + 110 },
        ],
        stroke: INK,
        width: 20,
      });
    } else {
      const landingH = room.h * 0.22;
      const flightEnd = reversed ? room.y + room.h : room.y + room.h - landingH;
      const flightStart = reversed ? room.y + landingH : room.y;
      const midX = room.x + room.w / 2;
      shapes.push({ kind: 'line', x1: midX, y1: flightStart, x2: midX, y2: flightEnd, stroke: WALL, width: 18 });
      for (let y = flightStart + spacing; y < flightEnd - 40; y += spacing) {
        shapes.push({ kind: 'line', x1: room.x, y1: y, x2: midX, y2: y, stroke: WALL_LIGHT, width: 16 });
        shapes.push({ kind: 'line', x1: midX, y1: y, x2: room.x + room.w, y2: y, stroke: WALL_LIGHT, width: 16 });
      }
      const ay0 = reversed ? room.y + room.h - 200 : room.y + 200;
      const ay1 = reversed ? room.y + landingH * 0.55 : room.y + room.h - landingH * 0.55;
      const x1 = room.x + room.w * 0.25;
      const x2 = room.x + room.w * 0.75;
      shapes.push({
        kind: 'polyline',
        points: [
          { x: x1, y: ay0 },
          { x: x1, y: ay1 },
          { x: x2, y: ay1 },
          { x: x2, y: ay0 },
        ],
        stroke: INK,
        width: 20,
      });
      const wing = reversed ? -110 : 110;
      shapes.push({
        kind: 'polyline',
        points: [
          { x: x2 - 110, y: ay0 + wing },
          { x: x2, y: ay0 },
          { x: x2 + 110, y: ay0 + wing },
        ],
        stroke: INK,
        width: 20,
      });
    }
    return shapes;
  }

  // Straight (default): treads across the short axis, arrow along the long.
  const dim = horizontal ? room.w : room.h;
  const shaftFrom = reversed ? dim - 120 : 120;
  const shaftTo = reversed ? 200 : dim - 200;
  const wingBack = reversed ? shaftTo + 120 : shaftTo - 120;
  if (horizontal) {
    for (let x = room.x + spacing; x < room.x + room.w - 40; x += spacing) {
      shapes.push({ kind: 'line', x1: x, y1: room.y, x2: x, y2: room.y + room.h, stroke: WALL_LIGHT, width: 16 });
    }
    const midY = room.y + room.h / 2;
    shapes.push({ kind: 'line', x1: room.x + shaftFrom, y1: midY, x2: room.x + shaftTo, y2: midY, stroke: INK, width: 22 });
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
    shapes.push({ kind: 'line', x1: midX, y1: room.y + shaftFrom, x2: midX, y2: room.y + shaftTo, stroke: INK, width: 22 });
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
  return shapes;
}

/** Context openingShapes needs from the wider doc: what colour fills the door
 *  threshold (the adjacent room's floor) and which way a bay/box window bumps. */
export interface OpeningRenderCtx {
  /** floor colour continuing through a door gap (null = leave unpainted) */
  thresholdFill?: string | null;
  /** +1 = along wallNormal, -1 = opposite; which side is "outside" */
  outwardSign?: 1 | -1;
}

/** Compute OpeningRenderCtx by sampling which rooms sit either side. */
export function openingRenderCtx(
  doc: FloorDoc,
  wall: Wall,
  opening: Opening,
  planMode: 'technical' | 'presentation' = 'technical',
): OpeningRenderCtx {
  const { start, end } = openingJambs(wall, opening);
  const n = wallNormal(wall);
  const c = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const roomAt = (sgn: number) => {
    const p = { x: c.x + n.x * sgn * (wall.thickness / 2 + 150), y: c.y + n.y * sgn * (wall.thickness / 2 + 150) };
    return doc.rooms.find((r) => r.type !== 'Stairs' && pointInPolygon(p, roomPolygon(r)));
  };
  if (opening.kind === 'door') {
    const sgn = opening.swingSide === 'b' ? -1 : 1;
    const room = roomAt(sgn) ?? roomAt(-sgn);
    const fill = room
      ? planMode === 'presentation'
        ? ROOM_ZONE_COLORS[room.type].fill
        : '#FFFFFF'
      : null;
    return { thresholdFill: fill };
  }
  const aRoom = roomAt(1);
  const bRoom = roomAt(-1);
  const outwardSign: 1 | -1 = aRoom && !bRoom ? -1 : 1;
  return { outwardSign };
}

export function openingShapes(wall: Wall, opening: Opening, ctx: OpeningRenderCtx = {}): Shape[] {
  const { start, end } = openingJambs(wall, opening);
  const n = wallNormal(wall);
  const t = wall.thickness;

  const shapes: Shape[] = [];
  const jambCaps = () => {
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
  };

  if (opening.kind === 'window') {
    const style = opening.windowStyle ?? 'standard';
    if (style === 'bay' || style === 'box') {
      // Projection drawn as plan graphics on the outside of the wall line.
      const sgn = ctx.outwardSign ?? 1;
      const out = { x: n.x * sgn, y: n.y * sgn };
      const dirLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const dir = { x: (end.x - start.x) / dirLen, y: (end.y - start.y) / dirLen };
      const D = style === 'bay' ? 620 : 520;
      const off = (p: Point, alongMm: number, outMm: number): Point => ({
        x: p.x + dir.x * alongMm + out.x * outMm,
        y: p.y + dir.y * alongMm + out.y * outMm,
      });
      const ring =
        style === 'bay'
          ? [start, off(start, dirLen * 0.28, D), off(start, dirLen * 0.72, D), end]
          : [start, off(start, 0, D), off(start, dirLen, D), end];
      shapes.push({ kind: 'polyline', points: ring, stroke: WALL, width: 24, fill: '#FFFFFF', closed: true });
      // glazing line following the projection, pulled back toward the wall
      const inner = ring.map((p, i) => (i === 0 || i === ring.length - 1 ? p : { x: p.x - out.x * 170, y: p.y - out.y * 170 }));
      shapes.push({ kind: 'polyline', points: inner, stroke: WALL_LIGHT, width: 16 });
      jambCaps();
      return shapes;
    }
    // Standard: double-line window across the gap + jamb caps.
    const off = t * 0.28;
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
    jambCaps();
    return shapes;
  }

  // Doors. First paint the threshold so the floor colour runs through the
  // gap instead of leaving a white hole between two coloured rooms.
  if (ctx.thresholdFill) {
    shapes.push({
      kind: 'polyline',
      points: [
        { x: start.x + n.x * (t / 2), y: start.y + n.y * (t / 2) },
        { x: end.x + n.x * (t / 2), y: end.y + n.y * (t / 2) },
        { x: end.x - n.x * (t / 2), y: end.y - n.y * (t / 2) },
        { x: start.x - n.x * (t / 2), y: start.y - n.y * (t / 2) },
      ],
      stroke: ctx.thresholdFill,
      width: 4,
      fill: ctx.thresholdFill,
      closed: true,
    });
  }

  const style = opening.doorStyle ?? 'single';
  if (style === 'sliding') {
    // Two offset panels passing each other + a thin track.
    const off = t * 0.22;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const dirLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const dir = { x: (end.x - start.x) / dirLen, y: (end.y - start.y) / dirLen };
    shapes.push(
      { kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: WALL_LIGHT, width: 10 },
      {
        kind: 'line',
        x1: start.x + n.x * off,
        y1: start.y + n.y * off,
        x2: mid.x + dir.x * 100 + n.x * off,
        y2: mid.y + dir.y * 100 + n.y * off,
        stroke: WALL_LIGHT,
        width: 34,
      },
      {
        kind: 'line',
        x1: mid.x - dir.x * 100 - n.x * off,
        y1: mid.y - dir.y * 100 - n.y * off,
        x2: end.x - n.x * off,
        y2: end.y - n.y * off,
        stroke: WALL_LIGHT,
        width: 34,
      },
    );
    return shapes;
  }

  if (style === 'double') {
    // Two half-width leaves hinged at both jambs, meeting in the middle.
    const sgn = opening.swingSide === 'b' ? -1 : 1;
    const half = opening.widthMm / 2;
    const dirLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const dir = { x: (end.x - start.x) / dirLen, y: (end.y - start.y) / dirLen };
    const dirDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const cz = dir.x * (n.y * sgn) - dir.y * (n.x * sgn);
    const swirl = cz > 0 ? 90 : -90;
    for (const [hingePt, baseDeg, sw] of [
      [start, dirDeg, swirl],
      [end, dirDeg + 180, -swirl],
    ] as const) {
      const tip = { x: hingePt.x + n.x * sgn * half, y: hingePt.y + n.y * sgn * half };
      shapes.push(
        { kind: 'line', x1: hingePt.x, y1: hingePt.y, x2: tip.x, y2: tip.y, stroke: WALL_LIGHT, width: 25 },
        {
          kind: 'arc',
          cx: hingePt.x,
          cy: hingePt.y,
          r: half,
          startDeg: sw > 0 ? baseDeg : baseDeg + sw,
          endDeg: sw > 0 ? baseDeg + sw : baseDeg,
          anticlockwise: false,
          stroke: WALL_LIGHT,
          width: 20,
        },
      );
    }
    return shapes;
  }

  // Single (default): leaf at the hinge jamb + quarter swing arc.
  const { hinge, tip, startDeg, endDeg, delta } = doorSwingGeometry(wall, opening);
  shapes.push(
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
  );
  return shapes;
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
  const scale = label.scale ?? 1;
  // Heading style titles a structure ("Ground Floor") — bigger and bolder.
  const size = (label.heading ? 400 : 220) * scale;
  return [
    {
      kind: 'text',
      x: label.x,
      y: label.y,
      text: label.text,
      size,
      color: INK,
      font: 'sans',
      weight: label.heading ? 700 : 600,
      align: 'center',
    },
  ];
}

/** Group walls into connected structures: two walls join when an endpoint of
 *  one touches the other's endpoint or lies on its span (a T-junction). A
 *  physically detached wing then falls into its own group, so it gets its own
 *  overall dimensions instead of one line spanning the empty gap between it
 *  and the main building. */
export function wallComponents(walls: Wall[], eps = 80): Wall[][] {
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const nearSeg = (p: Point, a: Point, b: Point): boolean => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= eps;
  };
  const touch = (wi: Wall, wj: Wall): boolean =>
    nearSeg(wi.a, wj.a, wj.b) ||
    nearSeg(wi.b, wj.a, wj.b) ||
    nearSeg(wj.a, wi.a, wi.b) ||
    nearSeg(wj.b, wi.a, wi.b);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      if (touch(walls[i], walls[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Wall[]>();
  walls.forEach((w, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(w);
  });
  return [...groups.values()];
}

function boundsDimensionShapes(minX: number, minY: number, maxX: number, maxY: number): Shape[] {
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

function dimensionShapes(doc: FloorDoc): Shape[] {
  // One set of overall dimensions per detached wall structure — a separate
  // wing measures on its own, never joined to the main block by a single
  // spanning line.
  const components = wallComponents(doc.walls).filter((g) => g.length > 0);
  const rings = components
    .map((walls) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const w of walls) {
        for (const p of [w.a, w.b]) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      return { minX, minY, maxX, maxY };
    })
    // Skip slivers (a single stray wall) that would just clutter the sheet.
    .filter((b) => maxSpan(b) > 400);

  if (rings.length === 0) {
    const bounds = docBounds(doc);
    if (!bounds) return [];
    return boundsDimensionShapes(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  }
  return rings.flatMap((b) => boundsDimensionShapes(b.minX, b.minY, b.maxX, b.maxY));
}

function maxSpan(b: { minX: number; minY: number; maxX: number; maxY: number }): number {
  return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

/** Flatten a floor document into ordered drawing primitives (world mm). */
export function docToShapes(doc: FloorDoc, options: DocShapesOptions = {}): Shape[] {
  const { showDims = true, showLabels = true, planMode = 'technical', areaUnits = 'm2' } = options;
  const shapes: Shape[] = [];

  // Largest-area first so a smaller nested room (e.g. stairs inside a
  // hallway) always draws on top instead of being covered by — or
  // covering the label of — the bigger room it sits inside.
  const roomsByAreaDesc = [...doc.rooms].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const room of roomsByAreaDesc) {
    const labelOffset = resolveRoomLabelOffset(room, doc.symbols, doc.walls);
    shapes.push(...roomShapes(room, showLabels, planMode, labelOffset, areaUnits));
  }

  for (const wall of doc.walls) {
    for (const quad of wallBodyQuads(wall, doc.walls, doc.openings)) {
      // Filled mitred quad — joins cleanly at any angle, unlike a stroked
      // centreline whose square cap pokes out at non-90° joints.
      shapes.push({ kind: 'polyline', points: quad, stroke: WALL, width: 8, fill: WALL, closed: true });
    }
  }

  for (const opening of doc.openings) {
    const wall = doc.walls.find((w) => w.id === opening.wallId);
    if (wall) shapes.push(...openingShapes(wall, opening, openingRenderCtx(doc, wall, opening, planMode)));
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
      case 'image':
        return { ...s, x: sx(s.x), y: sy(s.y), w: s.w * scale, h: s.h * scale };
    }
  });
}
