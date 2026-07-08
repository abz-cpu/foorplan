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
 *    boundary is fully sealed is a detected room. Regions that don't tile a
 *    single rectangle (L-shapes, staggered walls) are decomposed into a
 *    small set of maximal rectangles (rectangleDecomposition below) — one
 *    RoomRect per rectangle, sharing one auto-generated name, since the
 *    document model has no polygon room type to hold a single non-rectangular
 *    shape. Area/GIA/heat-loss totals are unaffected (they already sum
 *    across every room rect); the only visible seam is that an L-shaped
 *    room's "room count" shows 2+ instead of 1.
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

interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** Largest all-true axis-aligned rectangle in a boolean grid (classic
 *  histogram method, O(rows*cols)), or null if the grid is empty. */
function largestRectangle(grid: boolean[][]): (CellRect & { area: number }) | null {
  const rows = grid.length;
  if (rows === 0) return null;
  const cols = grid[0].length;
  const heights = new Array(cols).fill(0);
  let best: (CellRect & { area: number }) | null = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = grid[r][c] ? heights[c] + 1 : 0;

    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const height = heights[stack.pop()!];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const area = height * width;
        if (!best || area > best.area) {
          best = { area, r0: r - height + 1, c0: left, r1: r, c1: c - 1 };
        }
      }
      stack.push(c);
    }
  }
  return best;
}

/** Greedily covers a rectilinear region (a set of grid cells) with the
 *  smallest practical number of maximal rectangles: repeatedly extract the
 *  largest remaining rectangle until every cell is covered. Not guaranteed
 *  globally minimal (true minimum decomposition is a harder matching
 *  problem) but produces 2-3 pieces for typical L/T/U-shaped rooms. */
function decomposeIntoRects(cells: Set<string>, cMin: number, cMax: number, rMin: number, rMax: number): CellRect[] {
  const width = cMax - cMin + 1;
  const height = rMax - rMin + 1;
  const grid: boolean[][] = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => cells.has(`${c + cMin},${r + rMin}`)),
  );
  const rects: CellRect[] = [];
  const MAX_PIECES = 12; // safety cap; realistic architecture never gets close
  while (rects.length < MAX_PIECES) {
    const found = largestRectangle(grid);
    if (!found || found.area <= 0) break;
    rects.push({ c0: found.c0 + cMin, r0: found.r0 + rMin, c1: found.c1 + cMin, r1: found.r1 + rMin });
    for (let r = found.r0; r <= found.r1; r++) {
      for (let c = found.c0; c <= found.c1; c++) grid[r][c] = false;
    }
  }
  return rects;
}

/** Detect enclosed rooms from the wall layout — rectangles directly,
 *  rectilinear (L/T/U-shaped) loops as several rectangles sharing one name. */
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

    const cMin = Math.min(...cells.map(([c]) => c));
    const cMax = Math.max(...cells.map(([c]) => c));
    const rMin = Math.min(...cells.map(([, r]) => r));
    const rMax = Math.max(...cells.map(([, r]) => r));
    const isRectangular = cells.length === (cMax - cMin + 1) * (rMax - rMin + 1);

    const cellRects: CellRect[] = isRectangular
      ? [{ c0: cMin, r0: rMin, c1: cMax, r1: rMax }]
      : decomposeIntoRects(new Set(cells.map(([c, r]) => `${c},${r}`)), cMin, cMax, rMin, rMax);

    const roomName = `Room ${doc.rooms.length + rooms.length + 1}`;
    const inset = 50; // half a typical wall thickness, so the room sits inside the walls

    for (const cr of cellRects) {
      const x = xs[cr.c0];
      const y = ys[cr.r0];
      const w = xs[cr.c1 + 1] - x;
      const h = ys[cr.r1 + 1] - y;
      if (w < 600 || h < 600) continue; // implausibly small

      // Skip when an existing room's centre already lies inside this rect.
      const taken = doc.rooms.some((room) => {
        const rcx = room.x + room.w / 2;
        const rcy = room.y + room.h / 2;
        return rcx > x && rcx < x + w && rcy > y && rcy < y + h;
      });
      if (taken) continue;

      rooms.push({
        id: newId(),
        x: x + inset,
        y: y + inset,
        w: w - inset * 2,
        h: h - inset * 2,
        name: roomName,
        type: 'Other',
        ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
        includeInGia: true,
      });
    }
  }
  return rooms;
}
