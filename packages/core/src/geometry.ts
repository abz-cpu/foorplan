import type { FloorDoc, Point, RoomRect, Wall } from './types';

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function wallLengthMm(wall: Wall): number {
  return distance(wall.a, wall.b);
}

export function mmToM(mm: number): number {
  return mm / 1000;
}

/** Shoelace formula. Vertices in mm, result in mm². Winding order does not matter. */
export function polygonAreaMm2(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterMm(points: Point[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length]);
  }
  return sum;
}

/** A room's outline in absolute mm — its polygon if non-rectangular, else
 *  the four corners of its x/y/w/h rectangle. */
export function roomPolygon(room: RoomRect): Point[] {
  if (room.polygon && room.polygon.length >= 3) return room.polygon;
  return [
    { x: room.x, y: room.y },
    { x: room.x + room.w, y: room.y },
    { x: room.x + room.w, y: room.y + room.h },
    { x: room.x, y: room.y + room.h },
  ];
}

export function roomAreaM2(room: RoomRect): number {
  if (room.polygon && room.polygon.length >= 3) return polygonAreaMm2(room.polygon) / 1_000_000;
  return mmToM(room.w) * mmToM(room.h);
}

export function roomPerimeterM(room: RoomRect): number {
  if (room.polygon && room.polygon.length >= 3) return polygonPerimeterMm(room.polygon) / 1000;
  return 2 * (mmToM(room.w) + mmToM(room.h));
}

/** Area (mm²) covered by the UNION of axis-aligned rectangles — coordinate-
 *  compression sweep, so any region covered by more than one rectangle is
 *  counted once, not per-rectangle. */
export function rectUnionAreaMm2(rects: { x: number; y: number; w: number; h: number }[]): number {
  const valid = rects.filter((r) => r.w > 0 && r.h > 0);
  if (valid.length === 0) return 0;
  const xs = Array.from(new Set(valid.flatMap((r) => [r.x, r.x + r.w]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(valid.flatMap((r) => [r.y, r.y + r.h]))).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ys.length - 1; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (valid.some((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return area;
}

export interface RoomOverlap {
  a: RoomRect;
  b: RoomRect;
  areaM2: number;
}

/**
 * Pairs of GIA-counted rooms whose footprints overlap by a meaningful
 * amount (a drawing mistake — real adjacent rooms are inset from their
 * shared wall and never touch). Stairs are assets nested inside rooms by
 * design, so they're excluded.
 */
export function findRoomOverlaps(doc: FloorDoc): RoomOverlap[] {
  const rooms = doc.rooms.filter((r) => r.includeInGia && r.type !== 'Stairs');
  const out: RoomOverlap[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 50 && oy > 50) out.push({ a, b, areaM2: (ox * oy) / 1_000_000 });
    }
  }
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of all geometry in the doc, or null for an empty doc. */
export function docBounds(doc: FloorDoc): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const w of doc.walls) {
    eat(w.a.x, w.a.y);
    eat(w.b.x, w.b.y);
  }
  for (const r of doc.rooms) {
    eat(r.x, r.y);
    eat(r.x + r.w, r.y + r.h);
  }
  for (const s of doc.symbols) {
    eat(s.x, s.y);
    eat(s.x + s.w, s.y + s.h);
  }
  for (const l of doc.labels) eat(l.x, l.y);
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}
