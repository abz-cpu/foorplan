import polygonClipping from 'polygon-clipping';
import { polygonAreaMm2, polygonPerimeterMm } from './geometry';
import { wallNormal } from './openings';
import type { FloorDoc, Point } from './types';

export interface FloorFootprint {
  /** area of the union of all rooms, m² */
  areaM2: number;
  /**
   * Heat-loss (exposed) perimeter of the floor in metres: the boundary length
   * of the union of all rooms. Shared edges between adjacent rooms do not
   * count. Inner courts (holes) are included — they are exposed boundary too.
   */
  exposedPerimeterM: number;
}

function ringToPoints(ring: [number, number][]): Point[] {
  const pts = ring.map(([x, y]) => ({ x, y }));
  // polygon-clipping may close rings by repeating the first vertex — strip it.
  if (
    pts.length > 1 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y
  ) {
    pts.pop();
  }
  return pts;
}

function roomUnion(doc: FloorDoc) {
  if (doc.rooms.length === 0) return [];
  const polys: [number, number][][][] = doc.rooms.map((r) => [
    [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ],
  ]);
  return polygonClipping.union(polys[0] as never, ...(polys.slice(1) as never[]));
}

/** Union all room rectangles of a floor into its footprint measurements. */
export function floorFootprint(doc: FloorDoc): FloorFootprint {
  const union = roomUnion(doc);
  let areaMm2 = 0;
  let perimeterMm = 0;
  for (const poly of union) {
    poly.forEach((ring, i) => {
      const pts = ringToPoints(ring as [number, number][]);
      const ringArea = polygonAreaMm2(pts);
      areaMm2 += i === 0 ? ringArea : -ringArea; // holes subtract
      perimeterMm += polygonPerimeterMm(pts); // holes are exposed boundary
    });
  }
  return { areaM2: areaMm2 / 1e6, exposedPerimeterM: perimeterMm / 1000 };
}

function pointNearAnyRoom(doc: FloorDoc, p: Point, toleranceMm: number): boolean {
  for (const r of doc.rooms) {
    if (
      p.x >= r.x - toleranceMm &&
      p.x <= r.x + r.w + toleranceMm &&
      p.y >= r.y - toleranceMm &&
      p.y <= r.y + r.h + toleranceMm
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Which walls sit on the building's exposed (heat-loss) boundary: sample
 * points just off each side of the wall (using its normal), at several
 * positions along its length, and check whether a room is nearby on each
 * side. A wall with a room on exactly one side is external (interior on
 * one face, outside on the other); a room on both sides is an internal
 * partition; a room on neither side can't be classified (nothing drawn
 * nearby). Multiple sample points guard against the wall's exact midpoint
 * landing in the inset gap of some unrelated perpendicular wall (common
 * whenever a partition sits near the middle of the wall being tested).
 *
 * Deliberately not based on matching wall geometry against the room-union
 * boundary: rooms are inset from wall centrelines by the wall's own
 * thickness (so GIA excludes wall thickness), which means two rooms either
 * side of a shared internal wall never actually touch — their footprints
 * always leave a gap at that wall, so the union never merges across it and
 * every internal wall would wrongly look "exposed" to a boundary-matching
 * approach. Sampling points sidesteps that entirely.
 */
export function classifyExternalWalls(doc: FloorDoc, toleranceMm = 30): Set<string> {
  const externalIds = new Set<string>();
  if (doc.rooms.length === 0) return externalIds;

  const SAMPLE_FRACTIONS = [0.5, 0.25, 0.75, 0.1, 0.9];

  for (const wall of doc.walls) {
    const n = wallNormal(wall);
    // Clears this wall's own inset gap (half its thickness) with a fixed
    // margin, small enough to stay inside even a minimum-size (500mm) room.
    const offset = wall.thickness / 2 + 120;
    let externalVotes = 0;
    let internalVotes = 0;

    for (const t of SAMPLE_FRACTIONS) {
      const p = { x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t };
      const sideA = { x: p.x + n.x * offset, y: p.y + n.y * offset };
      const sideB = { x: p.x - n.x * offset, y: p.y - n.y * offset };
      const aHasRoom = pointNearAnyRoom(doc, sideA, toleranceMm);
      const bHasRoom = pointNearAnyRoom(doc, sideB, toleranceMm);
      if (aHasRoom !== bHasRoom) externalVotes++;
      else if (aHasRoom && bHasRoom) internalVotes++;
      // neither side has a room -> inconclusive sample, no vote either way
    }

    if (externalVotes > internalVotes) externalIds.add(wall.id);
  }
  return externalIds;
}
