import { wallSegments } from './openings';
import type { FloorDoc, Opening, Point, Wall } from './types';

/**
 * Mitred wall bodies. Stroked centrelines with square caps overshoot at any
 * joint that isn't 0°/90° — a 45° bay wall's cap pokes diagonally past its
 * neighbour's face. Rendering each wall as a QUAD whose end corners are the
 * mitre intersection with its single joint partner gives clean CAD-style
 * joins at every angle; free ends and 3+-way junctions keep the familiar
 * square-cap look.
 */

const JOIN_EPS = 2; // mm — endpoints within this are "the same joint"

type Corners = { left: Point; right: Point };

function unit(from: Point, to: Point): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
}

/** End corners at endpoint `p` of wall `w`, where `other` is the wall's other
 *  endpoint. `partners` are the other walls sharing `p`. */
function endCorners(w: Wall, p: Point, other: Point, partners: Wall[]): Corners {
  const h = w.thickness / 2;
  const dIn = unit(other, p); // direction of travel INTO the joint
  const nIn = { x: -dIn.y, y: dIn.x }; // left normal

  if (partners.length === 1) {
    const q = partners[0];
    const qOther = Math.hypot(q.a.x - p.x, q.a.y - p.y) <= JOIN_EPS ? q.b : q.a;
    const dOut = unit(p, qOther); // continuing OUT of the joint along the partner
    const dot = dIn.x * dOut.x + dIn.y * dOut.y;
    if (dot < -0.999) {
      // Partner doubles straight back — treat as a free end below.
    } else {
      // True corner: intersect this wall's face line with the partner's face
      // line ON THE SAME SIDE. Unlike the symmetric-mitre shortcut this stays
      // exact when the two walls have different thicknesses (a thin step wall
      // meeting a thick external wall) — the shortcut leaves a notch there.
      const hq = q.thickness / 2;
      const nOut = { x: -dOut.y, y: dOut.x };
      const cross = dIn.x * dOut.y - dIn.y * dOut.x;
      if (Math.abs(cross) > 1e-6) {
        const maxRun = Math.max(w.thickness, q.thickness) * 2.5;
        const corner = (side: 1 | -1): Point => {
          const ax = p.x + nIn.x * h * side;
          const ay = p.y + nIn.y * h * side;
          const bx = p.x + nOut.x * hq * side;
          const by = p.y + nOut.y * hq * side;
          // Solve a + s·dIn = b + u·dOut for s; clamp so near-collinear
          // joints can't spike.
          let s = ((bx - ax) * dOut.y - (by - ay) * dOut.x) / cross;
          s = Math.max(-maxRun, Math.min(maxRun, s));
          return { x: ax + dIn.x * s, y: ay + dIn.y * s };
        };
        return { left: corner(1), right: corner(-1) };
      }
      // ~180° continuation: plain perpendicular cut.
      return {
        left: { x: p.x + nIn.x * h, y: p.y + nIn.y * h },
        right: { x: p.x - nIn.x * h, y: p.y - nIn.y * h },
      };
    }
  }

  // Free end, or a 3+-way junction: emulate the square cap (extend half a
  // thickness past the endpoint) so existing plans look unchanged there.
  const ext = { x: p.x + dIn.x * h, y: p.y + dIn.y * h };
  return {
    left: { x: ext.x + nIn.x * h, y: ext.y + nIn.y * h },
    right: { x: ext.x - nIn.x * h, y: ext.y - nIn.y * h },
  };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_EPS;
}

/**
 * The filled quads that draw one wall: one per solid segment between
 * openings. True wall ends carry mitred/capped corners; segment ends at a
 * door or window jamb are plain perpendicular cuts, flush with the frame.
 */
export function wallBodyQuads(wall: Wall, allWalls: Wall[], openings: Opening[]): Point[][] {
  const partnersAt = (p: Point) =>
    allWalls.filter((o) => o.id !== wall.id && (samePoint(o.a, p) || samePoint(o.b, p)));

  const h = wall.thickness / 2;
  const d = unit(wall.a, wall.b);
  const n = { x: -d.y, y: d.x };
  const cornersA = endCorners(wall, wall.a, wall.b, partnersAt(wall.a));
  const cornersB = endCorners(wall, wall.b, wall.a, partnersAt(wall.b));

  return wallSegments(wall, openings)
    .filter((seg) => Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) > 1)
    .map((seg) => {
      const atA = samePoint(seg.a, wall.a);
      const atB = samePoint(seg.b, wall.b);
      // Note: travelling a→b, the joint corners at `a` were computed with the
      // inbound direction reversed, so left/right swap at that end.
      const startLeft = atA ? cornersA.right : { x: seg.a.x + n.x * h, y: seg.a.y + n.y * h };
      const startRight = atA ? cornersA.left : { x: seg.a.x - n.x * h, y: seg.a.y - n.y * h };
      const endLeft = atB ? cornersB.left : { x: seg.b.x + n.x * h, y: seg.b.y + n.y * h };
      const endRight = atB ? cornersB.right : { x: seg.b.x - n.x * h, y: seg.b.y - n.y * h };
      return [startLeft, endLeft, endRight, startRight];
    });
}

/** All wall quads for a floor — convenience for renderers. */
export function docWallQuads(doc: FloorDoc): { wallId: string; quad: Point[] }[] {
  return doc.walls.flatMap((w) =>
    wallBodyQuads(w, doc.walls, doc.openings).map((quad) => ({ wallId: w.id, quad })),
  );
}
