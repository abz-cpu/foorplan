import { distance, wallLengthMm } from './geometry';
import type { FloorDoc, Opening, Point, Wall } from './types';

/** Unit vector a→b. Zero-length walls return {0,0}. */
export function wallDirection(wall: Wall): Point {
  const len = wallLengthMm(wall);
  if (len === 0) return { x: 0, y: 0 };
  return { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
}

/** Left-hand normal of a→b (perpendicular unit vector). */
export function wallNormal(wall: Wall): Point {
  const d = wallDirection(wall);
  return { x: -d.y, y: d.x };
}

/** Point at `offsetMm` along the wall from endpoint `a`. */
export function pointAlongWall(wall: Wall, offsetMm: number): Point {
  const d = wallDirection(wall);
  return { x: wall.a.x + d.x * offsetMm, y: wall.a.y + d.y * offsetMm };
}

/** Scalar projection of `p` onto the wall, clamped to [0, wall length], mm. */
export function nearestOffsetOnWall(wall: Wall, p: Point): number {
  const len = wallLengthMm(wall);
  if (len === 0) return 0;
  const d = wallDirection(wall);
  const t = (p.x - wall.a.x) * d.x + (p.y - wall.a.y) * d.y;
  return Math.min(Math.max(t, 0), len);
}

/** Perpendicular distance from `p` to the wall segment, mm. */
export function distanceToWall(wall: Wall, p: Point): number {
  const offset = nearestOffsetOnWall(wall, p);
  return distance(p, pointAlongWall(wall, offset));
}

/** Clamp an opening's centre offset so the whole opening stays on the wall. */
export function clampOpeningOffset(wall: Wall, offsetMm: number, widthMm: number): number {
  const len = wallLengthMm(wall);
  const half = widthMm / 2;
  if (len <= widthMm) return len / 2;
  return Math.min(Math.max(offsetMm, half), len - half);
}

/** The two jamb points of an opening on its wall (start = nearer `a`). */
export function openingJambs(wall: Wall, opening: Opening): { start: Point; end: Point } {
  const clamped = clampOpeningOffset(wall, opening.offsetMm, opening.widthMm);
  return {
    start: pointAlongWall(wall, clamped - opening.widthMm / 2),
    end: pointAlongWall(wall, clamped + opening.widthMm / 2),
  };
}

/**
 * Wall segments remaining after subtracting its openings — what the renderer
 * actually draws as solid wall.
 */
export function wallSegments(wall: Wall, openings: Opening[]): { a: Point; b: Point }[] {
  const len = wallLengthMm(wall);
  const spans = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const c = clampOpeningOffset(wall, o.offsetMm, o.widthMm);
      return [c - o.widthMm / 2, c + o.widthMm / 2] as const;
    })
    .sort((s, t) => s[0] - t[0]);

  const segments: { a: Point; b: Point }[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) {
      segments.push({ a: pointAlongWall(wall, cursor), b: pointAlongWall(wall, start) });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < len) {
    segments.push({ a: pointAlongWall(wall, cursor), b: wall.b });
  }
  return segments;
}

/** Find the nearest wall within `toleranceMm` of a point, or null. */
export function nearestWall(
  doc: FloorDoc,
  p: Point,
  toleranceMm: number,
): { wall: Wall; offsetMm: number } | null {
  let best: { wall: Wall; offsetMm: number } | null = null;
  let bestDist = toleranceMm;
  for (const wall of doc.walls) {
    const d = distanceToWall(wall, p);
    if (d <= bestDist) {
      best = { wall, offsetMm: nearestOffsetOnWall(wall, p) };
      bestDist = d;
    }
  }
  return best;
}
