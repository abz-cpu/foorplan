import polygonClipping from 'polygon-clipping';
import { polygonAreaMm2, polygonPerimeterMm } from './geometry';
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

/** Union all room rectangles of a floor into its footprint measurements. */
export function floorFootprint(doc: FloorDoc): FloorFootprint {
  if (doc.rooms.length === 0) return { areaM2: 0, exposedPerimeterM: 0 };

  const polys: [number, number][][][] = doc.rooms.map((r) => [
    [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ],
  ]);

  const union = polygonClipping.union(polys[0] as never, ...(polys.slice(1) as never[]));

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
