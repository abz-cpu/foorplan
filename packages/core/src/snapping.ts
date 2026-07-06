import type { Point } from './types';
import { distance } from './geometry';

export function snapValueToGrid(v: number, gridMm: number): number {
  return Math.round(v / gridMm) * gridMm;
}

export function snapPointToGrid(p: Point, gridMm: number): Point {
  return { x: snapValueToGrid(p.x, gridMm), y: snapValueToGrid(p.y, gridMm) };
}

/**
 * Snap point `p` to the nearest of `candidates` within `toleranceMm`.
 * Returns the snapped candidate or null when nothing is close enough.
 */
export function snapToNearestPoint(
  p: Point,
  candidates: Point[],
  toleranceMm: number,
): Point | null {
  let best: Point | null = null;
  let bestDist = toleranceMm;
  for (const c of candidates) {
    const d = distance(p, c);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best ? { ...best } : null;
}

/**
 * Constrain a wall endpoint to horizontal/vertical relative to its start when
 * within `toleranceDeg` of an axis. Otherwise returns `end` unchanged.
 */
export function orthoSnap(start: Point, end: Point, toleranceDeg = 7): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  const angle = Math.abs(Math.atan2(dy, dx)) * (180 / Math.PI); // 0..180
  const distTo = (target: number) => Math.abs(angle - target);
  if (distTo(0) <= toleranceDeg || distTo(180) <= toleranceDeg) {
    return { x: end.x, y: start.y };
  }
  if (distTo(90) <= toleranceDeg) {
    return { x: start.x, y: end.y };
  }
  return end;
}

export interface WallEndSnapOptions {
  gridMm: number;
  endpoints: Point[];
  endpointToleranceMm: number;
  orthoToleranceDeg?: number;
}

/**
 * Full snap pipeline for the wall tool: existing endpoints win, then
 * ortho constraint relative to `start` (when given), then grid.
 */
export function snapWallEnd(raw: Point, start: Point | null, opts: WallEndSnapOptions): Point {
  const endpoint = snapToNearestPoint(raw, opts.endpoints, opts.endpointToleranceMm);
  if (endpoint) return endpoint;
  const ortho = start ? orthoSnap(start, raw, opts.orthoToleranceDeg) : raw;
  return snapPointToGrid(ortho, opts.gridMm);
}
