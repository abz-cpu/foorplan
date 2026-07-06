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

export function roomAreaM2(room: RoomRect): number {
  return mmToM(room.w) * mmToM(room.h);
}

export function roomPerimeterM(room: RoomRect): number {
  return 2 * (mmToM(room.w) + mmToM(room.h));
}

/** Gross internal area of a floor in m², honouring per-room include flags. */
export function floorGiaM2(doc: FloorDoc): number {
  return doc.rooms.filter((r) => r.includeInGia).reduce((sum, r) => sum + roomAreaM2(r), 0);
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
  for (const l of doc.labels) eat(l.x, l.y);
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}
