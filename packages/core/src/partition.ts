/**
 * Geometry for internal-partition drawing ("Free Wall") and perimeter closure
 * ("Wall by Wall"). Pure functions — no React/DOM/Konva — so they are
 * unit-tested in packages/core/test/partition.test.ts and reused by the editor
 * tools. Everything is in millimetres in world space, matching the rest of the
 * document model.
 */
import { distance, wallLengthMm } from './geometry';
import { roomPolygon } from './geometry';
import { pointInPolygon } from './faces';
import { nearestWall, pointAlongWall } from './openings';
import { DEFAULT_CEILING_HEIGHT_M } from './types';
import type { FloorDoc, Point, RoomRect, Wall } from './types';

/**
 * Standard floor-to-ceiling height (m) stamped on a room the instant a
 * Wall-by-Wall perimeter closes into a valid polygon — the same
 * DEFAULT_CEILING_HEIGHT_M every other tool uses, so volume/RdSAP data is
 * consistent no matter how the room was drawn.
 */
export const STANDARD_ROOM_HEIGHT_M = DEFAULT_CEILING_HEIGHT_M;

/** Nearest point on segment a→b to p, clamped to the segment. */
export function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function ringCentroid(ring: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * The (non-stairs) room whose interior contains `p`, by ray-casting. When rooms
 * nest, the smallest containing room wins so a partition attaches to the space
 * actually clicked rather than the outer shell.
 */
export function roomContainingPoint(doc: FloorDoc, p: Point): RoomRect | undefined {
  let best: RoomRect | undefined;
  let bestArea = Infinity;
  for (const room of doc.rooms) {
    if (room.type === 'Stairs') continue;
    if (!pointInPolygon(p, roomPolygon(room))) continue;
    const area = Math.abs(room.w * room.h) || Infinity;
    if (area < bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Pull `p` to inside `ring`. If already inside it is returned unchanged;
 * otherwise the nearest point on the polygon boundary is returned, nudged
 * `insetMm` toward the ring centroid so a partition node can touch but never
 * cross the perimeter (the "internal only" constraint for Free Wall).
 */
export function clampPointInsidePolygon(p: Point, ring: Point[], insetMm = 1): Point {
  if (ring.length < 3 || pointInPolygon(p, ring)) return p;
  let best = p;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const q = nearestPointOnSegment(p, a, b);
    const d = distance(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  const c = ringCentroid(ring);
  const toC = { x: c.x - best.x, y: c.y - best.y };
  const l = Math.hypot(toC.x, toC.y) || 1;
  return { x: best.x + (toC.x / l) * insetMm, y: best.y + (toC.y / l) * insetMm };
}

export interface PartitionSnap {
  wall: Wall;
  /** Projected point on the wall centreline. */
  point: Point;
  /** Offset along the wall from endpoint a (centreline), mm. */
  offsetMm: number;
  /** Perpendicular distance from the raw point to the wall, mm. */
  distanceMm: number;
  /** Corner→near-face gap toward endpoint a, mm (offset − thickness/2). */
  leftMm: number;
  /** Corner→near-face gap toward endpoint b, mm (length − offset − thickness/2). */
  rightMm: number;
}

/**
 * Snap `p` onto the nearest wall of `doc` within `tolMm`, or null if none is in
 * range. The along-wall gaps to each end are face-adjusted for a partition of
 * `thicknessMm` — measured corner → near face of the partition, the way a plan
 * is dimensioned — so `leftMm + thicknessMm + rightMm === wall length`.
 */
export function snapPointToWall(
  doc: FloorDoc,
  p: Point,
  tolMm: number,
  thicknessMm = 0,
): PartitionSnap | null {
  const near = nearestWall(doc, p, tolMm);
  if (!near) return null;
  const point = pointAlongWall(near.wall, near.offsetMm);
  const len = wallLengthMm(near.wall);
  const half = thicknessMm / 2;
  return {
    wall: near.wall,
    point,
    offsetMm: near.offsetMm,
    distanceMm: distance(p, point),
    leftMm: Math.max(0, near.offsetMm - half),
    rightMm: Math.max(0, len - near.offsetMm - half),
  };
}

/**
 * Is `p` within `thresholdMm` of the polyline's start point, i.e. close enough
 * to auto-close the loop? Requires at least 3 points placed so a single segment
 * can't "close" onto itself.
 */
export function isClosingPoint(chain: Point[], p: Point, thresholdMm: number): boolean {
  return chain.length >= 3 && distance(p, chain[0]) <= thresholdMm;
}
