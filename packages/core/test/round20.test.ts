import { describe, expect, it } from 'vitest';
import { addOpening, addRoom, addWall, emptyFloorDoc } from '../src/doc';
import { doorSwingGeometry } from '../src/openings';
import { arcSweep, openingRenderCtx, openingShapes } from '../src/shapes';
import { wallBodyQuads } from '../src/walljoin';
import type { Opening, Point, RoomRect, Wall } from '../src/types';

const closeTo = (p: Point, q: Point, eps = 0.001) =>
  Math.abs(p.x - q.x) <= eps && Math.abs(p.y - q.y) <= eps;

describe('arcSweep — direction-aware Konva arc normalisation', () => {
  it('keeps a plain forward quarter arc as-is', () => {
    expect(arcSweep({ startDeg: 0, endDeg: 90, anticlockwise: false })).toEqual({
      fromDeg: 0,
      sweepDeg: 90,
    });
  });

  it('handles the ±180° wrap without drawing the 270° complement', () => {
    // Flipped-hinge door: jamb at 180°, tip at −90° — a 90° clockwise
    // quarter. min/|Δ| mapping gave rotation −90 sweep 270 (the circular
    // door through the wall the user saw).
    expect(arcSweep({ startDeg: 180, endDeg: -90, anticlockwise: false })).toEqual({
      fromDeg: 180,
      sweepDeg: 90,
    });
  });

  it('reverses anticlockwise arcs into a forward sweep over the same angles', () => {
    expect(arcSweep({ startDeg: 0, endDeg: -90, anticlockwise: true })).toEqual({
      fromDeg: -90,
      sweepDeg: 90,
    });
  });

  it('keeps a near-full circle intact', () => {
    const { fromDeg, sweepDeg } = arcSweep({ startDeg: 0, endDeg: 359.99, anticlockwise: false });
    expect(fromDeg).toBe(0);
    expect(sweepDeg).toBeCloseTo(359.99, 6);
  });

  it('every hinge/swing combination of a real door stays a 90° sweep', () => {
    const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
    for (const hinge of ['left', 'right'] as const) {
      for (const swingSide of [undefined, 'b'] as const) {
        const opening: Opening = {
          id: 'd', wallId: 'w', kind: 'door', offsetMm: 2000, widthMm: 900, hinge, swingSide,
        };
        const g = doorSwingGeometry(wall, opening);
        const { sweepDeg } = arcSweep({
          startDeg: g.startDeg,
          endDeg: g.endDeg,
          anticlockwise: g.delta < 0,
        });
        expect(sweepDeg).toBeCloseTo(90, 6);
      }
    }
  });
});

describe('bay/box window ring closes the whole wall gap', () => {
  const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 };
  const win: Opening = { id: 'n', wallId: 'w', kind: 'window', offsetMm: 2000, widthMm: 1200, hinge: 'left' };

  it('box ring is anchored at the inner wall face, not the centreline', () => {
    // outwardSign −1 → out = (0, −1)·−1... wallNormal({4000,0}) = (0,1)? The
    // maths only needs: inner anchor sits half a thickness on the room side.
    const shapes = openingShapes(wall, { ...win, windowStyle: 'box' }, { outwardSign: -1 });
    const proj = shapes.find((s) => s.kind === 'polyline' && s.closed && s.fill === '#FFFFFF');
    expect(proj).toBeDefined();
    if (!proj || proj.kind !== 'polyline') return;
    const ys = proj.points.map((p) => p.y);
    // Wall spans y ∈ [−100, 100]. The ring must reach one face (inner,
    // +100 or −100) and project 420 beyond the opposite face (±520).
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(520, 3);
    expect(ys.filter((y) => Math.abs(Math.abs(y) - 100) < 0.001).length).toBe(2);
    // No point sits at the centreline — that produced the white slot.
    expect(ys.some((y) => Math.abs(y) < 1)).toBe(false);
  });

  it('bay apexes sit 520 beyond the outer face regardless of thickness', () => {
    for (const t of [100, 300]) {
      const w = { ...wall, thickness: t };
      const shapes = openingShapes(w, { ...win, windowStyle: 'bay' }, { outwardSign: -1 });
      const proj = shapes.find((s) => s.kind === 'polyline' && s.closed && s.fill === '#FFFFFF');
      expect(proj).toBeDefined();
      if (!proj || proj.kind !== 'polyline') continue;
      const depth = Math.max(...proj.points.map((p) => Math.abs(p.y)));
      expect(depth).toBeCloseTo(t / 2 + 520, 3);
    }
  });
});

describe('outward side survives a stepped wall next to the window', () => {
  it('projects away from the room even when the centre probe misses it', () => {
    // Wall along y=0; the room hugs only the left part of the window gap
    // (an L-shaped room stepping away), so the probe at the gap centre finds
    // no room on either side — but the 25% probe still lands inside.
    const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 };
    const win: Opening = { id: 'n', wallId: 'w', kind: 'window', offsetMm: 1000, widthMm: 1600, hinge: 'left' };
    const lRoom: RoomRect = {
      id: 'r', x: 100, y: 100, w: 3800, h: 3000,
      polygon: [
        { x: 100, y: 100 },
        { x: 900, y: 100 },
        { x: 900, y: 1500 },
        { x: 3900, y: 1500 },
        { x: 3900, y: 3100 },
        { x: 100, y: 3100 },
      ],
      name: 'Living Room', type: 'Living Room', ceilingHeightM: 2.4, includeInGia: true,
    };
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall);
    doc = addRoom(doc, lRoom);
    doc = addOpening(doc, win);
    // Gap spans x ∈ [200, 1800]; probes at 600/1000/1400. Only x=600 lies in
    // the room's near-wall strip (y up to 1500 → probe y=250 inside).
    const ctx = openingRenderCtx(doc, wall, { ...win, windowStyle: 'box' });
    expect(ctx.outwardSign).toBe(-1); // room is at +y → outward is −y
  });
});

describe('mitred joins with unequal wall thicknesses', () => {
  it('a thin wall meeting a thick wall shares both corner points (no notch)', () => {
    const thick: Wall = { id: 'A', a: { x: -3000, y: 0 }, b: { x: 0, y: 0 }, thickness: 300 };
    const thin: Wall = { id: 'B', a: { x: 0, y: 0 }, b: { x: 0, y: 2000 }, thickness: 100 };
    const walls = [thick, thin];
    const [quadA] = wallBodyQuads(thick, walls, []);
    const [quadB] = wallBodyQuads(thin, walls, []);
    // Exact face intersections: (−50, 150) and (50, −150).
    const expected: Point[] = [
      { x: -50, y: 150 },
      { x: 50, y: -150 },
    ];
    for (const e of expected) {
      expect(quadA.some((p) => closeTo(p, e))).toBe(true);
      expect(quadB.some((p) => closeTo(p, e))).toBe(true);
    }
  });

  it('equal-thickness right angles keep the familiar symmetric mitre', () => {
    const w1: Wall = { id: 'A', a: { x: -3000, y: 0 }, b: { x: 0, y: 0 }, thickness: 100 };
    const w2: Wall = { id: 'B', a: { x: 0, y: 0 }, b: { x: 0, y: 2000 }, thickness: 100 };
    const [quad] = wallBodyQuads(w1, [w1, w2], []);
    expect(quad.some((p) => closeTo(p, { x: -50, y: 50 }))).toBe(true);
    expect(quad.some((p) => closeTo(p, { x: 50, y: -50 }))).toBe(true);
  });

  it('a Z-step of mixed thickness leaves no gap at either joint', () => {
    // Vertical thick wall, short thin horizontal jog, then thick again —
    // the user's 0.60 m step. Each joint's two quads must share corners.
    const w1: Wall = { id: 'A', a: { x: 0, y: -3000 }, b: { x: 0, y: 0 }, thickness: 300 };
    const jog: Wall = { id: 'B', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 100 };
    const w2: Wall = { id: 'C', a: { x: 600, y: 0 }, b: { x: 600, y: 3000 }, thickness: 300 };
    const walls = [w1, jog, w2];
    const [q1] = wallBodyQuads(w1, walls, []);
    const [qj] = wallBodyQuads(jog, walls, []);
    const [q2] = wallBodyQuads(w2, walls, []);
    const shared = (qa: Point[], qb: Point[]) =>
      qa.filter((p) => qb.some((q) => closeTo(p, q))).length;
    expect(shared(q1, qj)).toBe(2);
    expect(shared(qj, q2)).toBe(2);
  });
});
