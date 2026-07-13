import polygonClipping from 'polygon-clipping';
import { polygonAreaMm2, polygonPerimeterMm, rectUnionAreaMm2, roomPolygon } from './geometry';
import { wallNormal } from './openings';
import type { FloorDoc, Point, Wall } from './types';

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
    roomPolygon(r).map((p) => [p.x, p.y] as [number, number]),
  ]);
  return polygonClipping.union(polys[0] as never, ...(polys.slice(1) as never[]));
}

/** A wall's axis-aligned footprint rectangle — the centreline segment's
 *  bounding box grown by half the thickness on every side (square caps, so
 *  corners where walls meet fill in). Accurate for axis-aligned walls
 *  (virtually all plans); for a diagonal wall it's a slight over-estimate. */
function wallRect(w: Wall): { x: number; y: number; w: number; h: number } {
  const half = w.thickness / 2;
  const x0 = Math.min(w.a.x, w.b.x) - half;
  const y0 = Math.min(w.a.y, w.b.y) - half;
  return {
    x: x0,
    y: y0,
    w: Math.abs(w.b.x - w.a.x) + w.thickness,
    h: Math.abs(w.b.y - w.a.y) + w.thickness,
  };
}

/**
 * Gross Internal Area of a floor in m² — measured to the INTERNAL face of
 * the enclosing (external) walls and INCLUDING internal partition walls, per
 * the RICS/RdSAP definition.
 *
 * Computed as (gross external footprint) − (external-wall footprint): the
 * whole building outline out to the external walls' outer faces, minus the
 * ring the external walls occupy, which leaves exactly the internal envelope
 * (internal partitions sit inside it and are counted). Rooms explicitly
 * excluded from GIA (includeInGia === false — e.g. an integral garage) are
 * then subtracted.
 *
 * Falls back to the union of the included rooms when no enclosing walls have
 * been classified yet (a partial sketch with no closed perimeter), so a
 * work-in-progress plan still reports a sensible figure.
 */
export function floorGiaM2(doc: FloorDoc): number {
  const externalIds = classifyExternalWalls(doc);
  if (externalIds.size === 0) {
    return rectUnionAreaMm2(doc.rooms.filter((r) => r.includeInGia)) / 1_000_000;
  }
  const allWallRects = doc.walls.map(wallRect);
  const extWallRects = doc.walls.filter((w) => externalIds.has(w.id)).map(wallRect);
  const grossExternal = rectUnionAreaMm2([...doc.rooms, ...allWallRects]);
  const externalWallFootprint = rectUnionAreaMm2(extWallRects);
  const excludedFootprint = rectUnionAreaMm2(doc.rooms.filter((r) => !r.includeInGia));
  return Math.max(0, grossExternal - externalWallFootprint - excludedFootprint) / 1_000_000;
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
