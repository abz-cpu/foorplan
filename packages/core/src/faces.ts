import type { Point, Wall } from './types';

/**
 * Planar face detection over a set of wall centrelines — finds every enclosed
 * region (room), following angled/bay walls and rectilinear L/T/U shapes
 * alike, unlike the old grid detector which only handled axis-aligned rooms.
 *
 * Pipeline: split every wall at intersections/T-junctions → build an
 * undirected planar graph → walk its faces (each interior face is a room) by
 * always taking the most-clockwise turn, which traces the region on the left
 * of each directed edge. The single unbounded outer face is dropped.
 */

const Q = 1; // quantise to 1mm — sub-mm precision is meaningless for walls

type Seg = { a: Point; b: Point };

function key(p: Point): string {
  return `${Math.round(p.x / Q)},${Math.round(p.y / Q)}`;
}

/** Parameter t∈[0,1] of the projection of p onto segment a→b, or null if p is
 *  not on the segment (within eps perpendicular distance). */
function paramOnSeg(p: Point, a: Point, b: Point, eps: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < -eps / Math.sqrt(len2) || t > 1 + eps / Math.sqrt(len2)) return null;
  const projx = a.x + t * dx;
  const projy = a.y + t * dy;
  if (Math.hypot(p.x - projx, p.y - projy) > eps) return null;
  return Math.max(0, Math.min(1, t));
}

/** Proper intersection point of segments a→b and c→d, or null. */
function segIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel/collinear handled via endpoints
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** Split walls at all mutual intersections / T-junctions into elementary edges. */
function planarEdges(walls: Wall[], eps: number): Seg[] {
  const segs: Seg[] = walls
    .map((w) => ({ a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } }))
    .filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > eps);

  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const ts = new Set<number>([0, 1]);
    for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      const o = segs[j];
      // T-junctions: the other segment's endpoints lying on s
      for (const p of [o.a, o.b]) {
        const t = paramOnSeg(p, s.a, s.b, eps);
        if (t !== null) ts.add(t);
      }
      // proper crossings
      const x = segIntersect(s.a, s.b, o.a, o.b);
      if (x) {
        const t = paramOnSeg(x, s.a, s.b, eps);
        if (t !== null) ts.add(t);
      }
    }
    const sorted = [...ts].sort((p, q) => p - q);
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    for (let k = 0; k < sorted.length - 1; k++) {
      const t0 = sorted[k];
      const t1 = sorted[k + 1];
      if (t1 - t0 < 1e-6) continue;
      const p0 = { x: s.a.x + dx * t0, y: s.a.y + dy * t0 };
      const p1 = { x: s.a.x + dx * t1, y: s.a.y + dy * t1 };
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > eps) out.push({ a: p0, b: p1 });
    }
  }
  return out;
}

/**
 * Every bounded face (enclosed region) of the wall network, as a ring of
 * points (centreline coordinates). Rings are oriented consistently; the outer
 * boundary and any degenerate (near-zero-area) faces are excluded.
 */
export function detectWallFaces(walls: Wall[], eps = 20): Point[][] {
  const edges = planarEdges(walls, eps);
  if (edges.length < 3) return [];

  // Unique vertices.
  const nodes = new Map<string, Point>();
  const node = (p: Point): string => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { x: Math.round(p.x), y: Math.round(p.y) });
    return k;
  };

  // Adjacency: node -> sorted outgoing half-edges (by angle).
  const adj = new Map<string, { to: string; angle: number }[]>();
  const undirected = new Set<string>();
  const addHalf = (from: string, to: string) => {
    const f = nodes.get(from)!;
    const t = nodes.get(to)!;
    const angle = Math.atan2(t.y - f.y, t.x - f.x);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, angle });
  };
  for (const e of edges) {
    const ka = node(e.a);
    const kb = node(e.b);
    if (ka === kb) continue;
    const uk = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (undirected.has(uk)) continue;
    undirected.add(uk);
    addHalf(ka, kb);
    addHalf(kb, ka);
  }
  for (const list of adj.values()) list.sort((p, q) => p.angle - q.angle);

  // Walk faces: from a directed edge u->v, the next edge is the one just
  // clockwise of the reverse (v->u) around v.
  const visited = new Set<string>();
  const hkey = (from: string, to: string) => `${from}>${to}`;
  const faces: Point[][] = [];

  for (const [from, outs] of adj) {
    for (const o of outs) {
      if (visited.has(hkey(from, o.to))) continue;
      const ring: string[] = [];
      let cf = from;
      let ct = o.to;
      let guard = 0;
      while (guard++ < 100000) {
        visited.add(hkey(cf, ct));
        ring.push(cf);
        // at ct, find reverse edge ct->cf, take the previous in CCW order
        // (= next clockwise), which keeps the face on a consistent side.
        const list = adj.get(ct)!;
        const revAngle = Math.atan2(nodes.get(cf)!.y - nodes.get(ct)!.y, nodes.get(cf)!.x - nodes.get(ct)!.x);
        let idx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < list.length; i++) {
          if (Math.abs(list[i].angle - revAngle) < 1e-9) {
            idx = i;
            bestDiff = 0;
            break;
          }
        }
        if (bestDiff !== 0) {
          // fallback: closest angle to reverse
          for (let i = 0; i < list.length; i++) {
            const d = Math.abs(list[i].angle - revAngle);
            if (d < bestDiff) {
              bestDiff = d;
              idx = i;
            }
          }
        }
        const next = list[(idx - 1 + list.length) % list.length];
        const nf = ct;
        const nt = next.to;
        if (nf === from && nt === o.to) break; // closed the face
        cf = nf;
        ct = nt;
      }
      if (ring.length >= 3) faces.push(ring.map((k) => nodes.get(k)!));
    }
  }

  // Keep bounded interior faces: signed area sign matches the majority
  // (interior) orientation; drop the single largest-|area| outer face and
  // any sliver faces.
  const withArea = faces
    .map((ring) => ({ ring, signed: signedArea(ring) }))
    .filter((f) => Math.abs(f.signed) > 1000); // > 0.001 m²
  if (withArea.length === 0) return [];
  // The outer face has the opposite winding to interior faces AND the
  // largest absolute area. Determine interior sign as the sign shared by
  // all but the largest-area face.
  let outerIdx = 0;
  for (let i = 1; i < withArea.length; i++) {
    if (Math.abs(withArea[i].signed) > Math.abs(withArea[outerIdx].signed)) outerIdx = i;
  }
  const interiorSign = -Math.sign(withArea[outerIdx].signed);
  return withArea
    .filter((_, i) => i !== outerIdx && Math.sign(withArea[i].signed) === interiorSign)
    .map((f) => (f.signed < 0 ? [...f.ring].reverse() : f.ring)); // normalise to CCW
}

function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/**
 * Shrink a simple polygon inward by `d` mm (offset every edge toward the
 * interior and re-intersect adjacent edges). Used so a detected room sits
 * inside the wall centrelines. Assumes CCW winding; falls back to the input
 * if the result degenerates.
 */
export function insetPolygon(points: Point[], d: number): Point[] {
  const n = points.length;
  if (n < 3 || d <= 0) return points;
  // ensure CCW
  const ccw = signedArea(points) > 0 ? points : [...points].reverse();
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % n];
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    ex /= len;
    ey /= len;
    // Interior is on the left of each edge for a positive-signed (CCW) ring;
    // the left normal of direction (ex,ey) is (-ey, ex).
    const nx = -ey;
    const ny = ex;
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, dx: ex, dy: ey });
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = lines[(i - 1 + n) % n];
    const l1 = lines[i];
    const denom = l0.dx * l1.dy - l0.dy * l1.dx;
    if (Math.abs(denom) < 1e-9) {
      out.push({ x: l1.px, y: l1.py });
      continue;
    }
    const t = ((l1.px - l0.px) * l1.dy - (l1.py - l0.py) * l1.dx) / denom;
    out.push({ x: l0.px + l0.dx * t, y: l0.py + l0.dy * t });
  }
  // guard against a collapsed/inverted result
  if (Math.abs(signedArea(out)) < 1000 || Math.sign(signedArea(out)) !== Math.sign(signedArea(ccw))) {
    return ccw;
  }
  return out;
}

/**
 * Like insetPolygon, but edge i (points[i] → points[i+1]) is offset inward by
 * its own distance dists[i]. Used so a detected room is inset to each
 * bounding wall's INNER face — a thick external wall pulls its edge in
 * further than a thin partition, leaving no white gap between the room fill
 * and the wall. Falls back to the input if the result degenerates.
 */
export function insetPolygonVariable(points: Point[], dists: number[]): Point[] {
  const n = points.length;
  if (n < 3) return points;
  const sign = signedArea(points) > 0 ? 1 : -1; // +1 = CCW, interior on the left
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    ex /= len;
    ey /= len;
    const nx = -ey * sign; // inward normal
    const ny = ex * sign;
    const d = dists[i] ?? 0;
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, dx: ex, dy: ey });
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = lines[(i - 1 + n) % n];
    const l1 = lines[i];
    const denom = l0.dx * l1.dy - l0.dy * l1.dx;
    if (Math.abs(denom) < 1e-9) {
      out.push({ x: l1.px, y: l1.py });
      continue;
    }
    const t = ((l1.px - l0.px) * l1.dy - (l1.py - l0.py) * l1.dx) / denom;
    out.push({ x: l0.px + l0.dx * t, y: l0.py + l0.dy * t });
  }
  if (Math.abs(signedArea(out)) < 1000 || Math.sign(signedArea(out)) !== Math.sign(signedArea(points))) {
    return points;
  }
  return out;
}

/** Axis-aligned bounding box of a ring. */
export function ringBounds(ring: Point[]): { x: number; y: number; w: number; h: number } {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** Area (mm²) shared by two rectilinear rings (0 when they only touch). */
export function ringsOverlapAreaMm2(a: Point[], b: Point[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const xs = [...new Set([...a, ...b].map((p) => p.x))].sort((s, t) => s - t);
  const ys = [...new Set([...a, ...b].map((p) => p.y))].sort((s, t) => s - t);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ys.length - 1; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (pointInPolygon({ x: cx, y: cy }, a) && pointInPolygon({ x: cx, y: cy }, b)) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return area;
}

/** True when two rectilinear rings share any interior area. */
export function ringsOverlap(a: Point[], b: Point[]): boolean {
  return ringsOverlapAreaMm2(a, b) > 0;
}

function simplifyRectilinear(pts: Point[]): Point[] {
  const n = pts.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const collinear =
      (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(cur.x - next.x) < 1e-6) ||
      (Math.abs(prev.y - cur.y) < 1e-6 && Math.abs(cur.y - next.y) < 1e-6);
    if (!collinear) out.push(cur);
  }
  return out;
}

function gridCoords(rings: Point[][]): { xs: number[]; ys: number[] } {
  const xs = [...new Set(rings.flatMap((r) => r.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = [...new Set(rings.flatMap((r) => r.map((p) => p.y)))].sort((a, b) => a - b);
  return { xs, ys };
}

/**
 * Trace the boundary rings of a filled region over a coordinate-compression
 * grid. `filled(i,j)` says whether cell (i,j) — spanning [xs[i],xs[i+1]] ×
 * [ys[j],ys[j+1]] — is inside the region; every grid edge between a filled and
 * an empty cell is emitted (filled side on the left), the edges are stitched
 * into closed rings, collinear points dropped, and rings returned largest-area
 * first (normalised CCW).
 */
function traceRectilinear(xs: number[], ys: number[], filled: (i: number, j: number) => boolean): Point[][] {
  const ni = xs.length - 1;
  const nj = ys.length - 1;
  if (ni < 1 || nj < 1) return [];
  const on = (i: number, j: number) => i >= 0 && i < ni && j >= 0 && j < nj && filled(i, j);

  type E = { ax: number; ay: number; bx: number; by: number };
  const edges: E[] = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      if (!filled(i, j)) continue;
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      if (!on(i - 1, j)) edges.push({ ax: x0, ay: y0, bx: x0, by: y1 }); // left edge, downward
      if (!on(i + 1, j)) edges.push({ ax: x1, ay: y1, bx: x1, by: y0 }); // right edge, upward
      if (!on(i, j - 1)) edges.push({ ax: x1, ay: y0, bx: x0, by: y0 }); // top edge, leftward
      if (!on(i, j + 1)) edges.push({ ax: x0, ay: y1, bx: x1, by: y1 }); // bottom edge, rightward
    }
  }

  const vkey = (x: number, y: number) => `${x},${y}`;
  const byStart = new Map<string, E[]>();
  for (const e of edges) {
    const k = vkey(e.ax, e.ay);
    (byStart.get(k) ?? byStart.set(k, []).get(k)!).push(e);
  }
  const used = new Set<E>();
  const out: Point[][] = [];
  for (const start of edges) {
    if (used.has(start)) continue;
    const pts: Point[] = [];
    let e: E | undefined = start;
    let guard = 0;
    while (e && !used.has(e) && guard++ < 1e6) {
      used.add(e);
      pts.push({ x: e.ax, y: e.ay });
      const cont = byStart.get(vkey(e.bx, e.by));
      e = cont?.find((c) => !used.has(c));
    }
    if (pts.length >= 4) {
      const ring = simplifyRectilinear(pts);
      if (ring.length >= 4) out.push(signedArea(ring) < 0 ? ring.reverse() : ring);
    }
  }
  return out.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}

/**
 * Boundary of the UNION of axis-aligned rectilinear polygons, as one or more
 * rings (mm), largest-area first.
 */
export function unionRectilinear(rings: Point[][]): Point[][] {
  const polys = rings.filter((r) => r.length >= 3);
  if (polys.length === 0) return [];
  const { xs, ys } = gridCoords(polys);
  return traceRectilinear(xs, ys, (i, j) => {
    const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    return polys.some((r) => pointInPolygon(c, r));
  });
}

/**
 * Boundary rings of `outer` with every ring in `holes` removed (rectangle −
 * rooms), largest-area first. A room drawn over existing rooms uses this so it
 * fits AROUND them — an L/T/U that respects the walls between — instead of
 * overlapping. Rectilinear shapes only.
 */
export function differenceRectilinear(outer: Point[], holes: Point[][]): Point[][] {
  if (outer.length < 3) return [];
  const hs = holes.filter((h) => h.length >= 3);
  const { xs, ys } = gridCoords([outer, ...hs]);
  return traceRectilinear(xs, ys, (i, j) => {
    const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    return pointInPolygon(c, outer) && !hs.some((h) => pointInPolygon(c, h));
  });
}

/** Point-in-polygon (ray casting). */
export function pointInPolygon(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
