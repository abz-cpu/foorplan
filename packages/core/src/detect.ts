import { DEFAULT_CEILING_HEIGHT_M, type FloorDoc, type RoomRect, type Wall } from './types';
import { newId } from './ids';

/**
 * Room auto-detection for axis-aligned wall layouts (the overwhelmingly
 * common case given ortho snapping). Dependency-free alternative to a full
 * topology suite:
 *
 * 1. Collect horizontal/vertical walls (within tolerance).
 * 2. The unique wall coordinates cut the plane into a grid of cells.
 * 3. A cell edge is "sealed" when a wall segment covers its full span.
 * 4. Region-grow cells through unsealed shared edges; a region whose outer
 *    boundary is fully sealed and whose cells exactly tile a rectangle is a
 *    detected room.
 *
 * Angled walls are ignored (documented limitation until a topology-suite
 * pass lands). Existing rooms suppress detections that contain them.
 */

const TOL = 5; // mm tolerance for collinearity/coverage

interface Interval {
  at: number; // fixed coordinate (y for horizontal, x for vertical)
  from: number;
  to: number;
}

function collectIntervals(walls: Wall[]) {
  const horizontal: Interval[] = [];
  const vertical: Interval[] = [];
  for (const w of walls) {
    if (Math.abs(w.a.y - w.b.y) <= TOL) {
      horizontal.push({ at: (w.a.y + w.b.y) / 2, from: Math.min(w.a.x, w.b.x), to: Math.max(w.a.x, w.b.x) });
    } else if (Math.abs(w.a.x - w.b.x) <= TOL) {
      vertical.push({ at: (w.a.x + w.b.x) / 2, from: Math.min(w.a.y, w.b.y), to: Math.max(w.a.y, w.b.y) });
    }
  }
  return { horizontal, vertical };
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > TOL) out.push(v);
  }
  return out;
}

/** Is the span [from, to] at coordinate `at` fully covered by intervals? */
function covered(intervals: Interval[], at: number, from: number, to: number): boolean {
  const relevant = intervals
    .filter((i) => Math.abs(i.at - at) <= TOL && i.from <= to - TOL && i.to >= from + TOL)
    .sort((a, b) => a.from - b.from);
  let cursor = from;
  for (const i of relevant) {
    if (i.from > cursor + TOL) return false;
    cursor = Math.max(cursor, i.to);
    if (cursor >= to - TOL) return true;
  }
  return cursor >= to - TOL;
}

/** Detect enclosed rectangular rooms from the wall layout. */
export function detectRooms(doc: FloorDoc): RoomRect[] {
  const { horizontal, vertical } = collectIntervals(doc.walls);
  if (horizontal.length < 2 || vertical.length < 2) return [];

  const xs = uniqueSorted(vertical.map((v) => v.at));
  const ys = uniqueSorted(horizontal.map((h) => h.at));
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  if (cols < 1 || rows < 1) return [];

  // sealed[edge between cells / boundary]
  const sealedH = (col: number, yIdx: number) => covered(horizontal, ys[yIdx], xs[col], xs[col + 1]);
  const sealedV = (xIdx: number, row: number) => covered(vertical, xs[xIdx], ys[row], ys[row + 1]);

  // region growing across unsealed edges
  const regionOf = new Array<number>(cols * rows).fill(-1);
  const idx = (c: number, r: number) => r * cols + c;
  let regions = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (regionOf[idx(c, r)] !== -1) continue;
      const stack = [[c, r]];
      regionOf[idx(c, r)] = regions;
      while (stack.length) {
        const [cc, cr] = stack.pop()!;
        const neighbours: [number, number, boolean][] = [
          [cc - 1, cr, !sealedV(cc, cr)],
          [cc + 1, cr, !sealedV(cc + 1, cr)],
          [cc, cr - 1, !sealedH(cc, cr)],
          [cc, cr + 1, !sealedH(cc, cr + 1)],
        ];
        for (const [nc, nr, open] of neighbours) {
          if (!open || nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          if (regionOf[idx(nc, nr)] === -1) {
            regionOf[idx(nc, nr)] = regions;
            stack.push([nc, nr]);
          }
        }
      }
      regions++;
    }
  }

  const rooms: RoomRect[] = [];
  for (let region = 0; region < regions; region++) {
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (regionOf[idx(c, r)] === region) cells.push([c, r]);
      }
    }
    if (cells.length === 0) continue;

    // Region must be fully enclosed: every outward edge sealed.
    let enclosed = true;
    for (const [c, r] of cells) {
      const out = (nc: number, nr: number) =>
        nc < 0 || nr < 0 || nc >= cols || nr >= rows || regionOf[idx(nc, nr)] !== region;
      if (out(c - 1, r) && !sealedV(c, r)) enclosed = false;
      if (out(c + 1, r) && !sealedV(c + 1, r)) enclosed = false;
      if (out(c, r - 1) && !sealedH(c, r)) enclosed = false;
      if (out(c, r + 1) && !sealedH(c, r + 1)) enclosed = false;
      if (!enclosed) break;
    }
    if (!enclosed) continue;

    // Cells must exactly tile a rectangle.
    const cMin = Math.min(...cells.map(([c]) => c));
    const cMax = Math.max(...cells.map(([c]) => c));
    const rMin = Math.min(...cells.map(([, r]) => r));
    const rMax = Math.max(...cells.map(([, r]) => r));
    if (cells.length !== (cMax - cMin + 1) * (rMax - rMin + 1)) continue;

    const x = xs[cMin];
    const y = ys[rMin];
    const w = xs[cMax + 1] - x;
    const h = ys[rMax + 1] - y;
    if (w < 600 || h < 600) continue; // implausibly small

    // Skip when an existing room's centre already lies inside this rect.
    const taken = doc.rooms.some((room) => {
      const rcx = room.x + room.w / 2;
      const rcy = room.y + room.h / 2;
      return rcx > x && rcx < x + w && rcy > y && rcy < y + h;
    });
    if (taken) continue;

    // Inset by half a typical wall thickness so the room sits inside walls.
    const inset = 50;
    rooms.push({
      id: newId(),
      x: x + inset,
      y: y + inset,
      w: w - inset * 2,
      h: h - inset * 2,
      name: `Room ${doc.rooms.length + rooms.length + 1}`,
      type: 'Other',
      ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
      includeInGia: true,
    });
  }
  return rooms;
}
