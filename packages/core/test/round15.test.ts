import { describe, expect, it } from 'vitest';
import { addRoom, addWall, emptyFloorDoc, wallsForPolygon } from '../src/doc';
import { detectRooms } from '../src/detect';
import {
  differenceRectilinear,
  insetPolygonVariable,
  pointInPolygon,
  ringsOverlap,
  unionRectilinear,
} from '../src/faces';
import { classifyExternalWalls } from '../src/measure';
import { polygonAreaMm2 } from '../src/geometry';
import { docToShapes, type Shape } from '../src/shapes';
import { smartRoomLabelOffset } from '../src/labels';
import type { SymbolInstance } from '../src/symbols';
import type { FloorDoc, Point, RoomRect, Wall } from '../src/types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, thickness = 100): Wall => ({
  id,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  thickness,
});

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('insetPolygonVariable', () => {
  it('insets each edge by its own distance', () => {
    // rect edges in order: top(0), right(1), bottom(2), left(3)
    const r = rect(0, 0, 4000, 3000);
    const out = insetPolygonVariable(r, [100, 50, 100, 50]);
    const b = {
      minX: Math.min(...out.map((p) => p.x)),
      maxX: Math.max(...out.map((p) => p.x)),
      minY: Math.min(...out.map((p) => p.y)),
      maxY: Math.max(...out.map((p) => p.y)),
    };
    // left/right edges inset by 50 each → width shrinks by 100; top/bottom by
    // 100 each → height shrinks by 200.
    expect(b.maxX - b.minX).toBeCloseTo(3900, 3);
    expect(b.maxY - b.minY).toBeCloseTo(2800, 3);
  });
});

describe('detectRooms — no white gap under thick walls', () => {
  it('insets a detected room to the inner face of external (thick) walls', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall('t', 0, 0, 4000, 0, 200));
    doc = addWall(doc, wall('r', 4000, 0, 4000, 3000, 200));
    doc = addWall(doc, wall('b', 0, 3000, 4000, 3000, 200));
    doc = addWall(doc, wall('l', 0, 0, 0, 3000, 200));
    const rooms = detectRooms(doc);
    expect(rooms).toHaveLength(1);
    // 200mm walls → inset 100 each side → 3800 x 2800 (meets inner faces),
    // not the old fixed-50 inset of 3900 x 2900 that left a visible gap.
    expect(rooms[0].w).toBe(3800);
    expect(rooms[0].h).toBe(2800);
  });
});

describe('classifyExternalWalls — polygon rooms', () => {
  it('does not flag a neighbour wall internal just because a shaped room bbox overlaps it', () => {
    // Bedroom: plain 3x3 rect room, walls all 200mm external.
    const bedroom: RoomRect = {
      id: 'bed',
      x: 0,
      y: 0,
      w: 3000,
      h: 3000,
      name: 'Bedroom 4',
      type: 'Bedroom',
      ceilingHeightM: 2.4,
      includeInGia: true,
    };
    // L-shaped room to the right; its BOUNDING BOX covers the outside of the
    // bedroom's right wall (~x=3220) but its actual outline does NOT.
    const lroom: RoomRect = {
      id: 'l',
      x: 3200,
      y: 0,
      w: 2800,
      h: 3000,
      polygon: [
        { x: 3200, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 3000 },
        { x: 4500, y: 3000 },
        { x: 4500, y: 1000 },
        { x: 3200, y: 1000 },
      ],
      name: 'Kitchen/Diner',
      type: 'Kitchen / Diner',
      ceilingHeightM: 2.4,
      includeInGia: true,
    };
    let doc: FloorDoc = emptyFloorDoc();
    doc = addRoom(doc, bedroom);
    doc = addRoom(doc, lroom);
    doc = addWall(doc, wall('bed-r', 3000, 0, 3000, 3000, 200));

    const external = classifyExternalWalls(doc);
    // The bedroom's right wall has a room only on its inside → external.
    expect(external.has('bed-r')).toBe(true);
  });
});

describe('wallsForPolygon', () => {
  const lRing: Point[] = [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 3000 },
    { x: 2000, y: 3000 },
    { x: 2000, y: 6000 },
    { x: 0, y: 6000 },
  ];

  it('adds one wall per outline edge when none exist yet', () => {
    const walls = wallsForPolygon(emptyFloorDoc(), lRing);
    expect(walls).toHaveLength(6);
  });

  it('skips an edge already covered by an existing wall', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall('top', 0, 0, 5000, 0));
    const walls = wallsForPolygon(doc, lRing);
    expect(walls).toHaveLength(5);
  });
});

describe('overall dimensions — per detached structure', () => {
  const monoLabels = (shapes: Shape[]) =>
    shapes.filter((s): s is Extract<Shape, { kind: 'text' }> => s.kind === 'text' && s.font === 'mono');

  function box(prefix: string, ox: number, oy: number): Wall[] {
    return [
      wall(`${prefix}t`, ox, oy, ox + 3000, oy),
      wall(`${prefix}r`, ox + 3000, oy, ox + 3000, oy + 3000),
      wall(`${prefix}b`, ox, oy + 3000, ox + 3000, oy + 3000),
      wall(`${prefix}l`, ox, oy, ox, oy + 3000),
    ];
  }

  it('draws one width+height pair for a single structure', () => {
    const doc: FloorDoc = { ...emptyFloorDoc(), walls: box('a', 0, 0) };
    const shapes = docToShapes(doc, { showDims: true, showLabels: false });
    expect(monoLabels(shapes)).toHaveLength(2); // one width, one height
  });

  it('draws a separate pair for each detached structure', () => {
    const doc: FloorDoc = { ...emptyFloorDoc(), walls: [...box('a', 0, 0), ...box('b', 20000, 0)] };
    const shapes = docToShapes(doc, { showDims: true, showLabels: false });
    expect(monoLabels(shapes)).toHaveLength(4); // two structures → two pairs
  });
});

describe('unionRectilinear / ringsOverlap', () => {
  it('merges two overlapping rectangles into a 6-corner L', () => {
    const a = rect(0, 0, 4000, 2000); // wide bottom
    const b = rect(0, 0, 2000, 4000); // tall left
    expect(ringsOverlap(a, b)).toBe(true);
    const rings = unionRectilinear([a, b]);
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBe(6); // an L
    // 8,000,000 + 8,000,000 − 4,000,000 overlap = 12,000,000 mm²
    expect(polygonAreaMm2(rings[0])).toBeCloseTo(12_000_000, 0);
  });

  it('reports no overlap for separated rectangles', () => {
    expect(ringsOverlap(rect(0, 0, 1000, 1000), rect(3000, 0, 1000, 1000))).toBe(false);
  });

  it('unions a rectangle onto an existing L (T/U build-up)', () => {
    const lshape: Point[] = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 2000, y: 2000 },
      { x: 2000, y: 4000 },
      { x: 0, y: 4000 },
    ];
    const addOn = rect(3000, 2000, 1000, 2000); // fills toward a U/rectangle-ish
    const rings = unionRectilinear([lshape, addOn]);
    expect(rings).toHaveLength(1);
    expect(polygonAreaMm2(rings[0])).toBeCloseTo(polygonAreaMm2(lshape) + 1000 * 2000, 0);
  });
});

describe('differenceRectilinear — carve a room around others', () => {
  it('subtracts a covered room, leaving an L that fits around it', () => {
    const drawn = rect(0, 0, 4000, 4000); // 16 m²
    const existing = rect(2000, 2000, 2000, 2000); // 4 m² in the bottom-right
    const pieces = differenceRectilinear(drawn, [existing]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBe(6); // an L
    expect(polygonAreaMm2(pieces[0])).toBeCloseTo(16_000_000 - 4_000_000, 0);
    // the carved-out corner is not part of the new room
    expect(pointInPolygon({ x: 3000, y: 3000 }, pieces[0])).toBe(false);
  });

  it('returns nothing when the drawn rectangle is fully covered', () => {
    const drawn = rect(1000, 1000, 1000, 1000);
    const existing = rect(0, 0, 4000, 4000);
    expect(differenceRectilinear(drawn, [existing])).toHaveLength(0);
  });

  it('leaves a plain rectangle when nothing is subtracted', () => {
    const drawn = rect(0, 0, 3000, 2000);
    const pieces = differenceRectilinear(drawn, []);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBe(4);
    expect(polygonAreaMm2(pieces[0])).toBeCloseTo(6_000_000, 0);
  });
});

describe('export room label matches canvas smart placement', () => {
  it('places the exported name label at the smart (furniture-dodging) offset', () => {
    const room: RoomRect = {
      id: 'r',
      x: 0,
      y: 0,
      w: 4000,
      h: 4000,
      name: 'Bedroom',
      type: 'Bedroom',
      ceilingHeightM: 2.4,
      includeInGia: true,
    };
    // A bed dead-centre pushes the smart label off the middle.
    const bed: SymbolInstance = { id: 'b', kind: 'bed-double', x: 1200, y: 1400, w: 1600, h: 1200, rotationDeg: 0 };
    const doc: FloorDoc = { ...emptyFloorDoc(), rooms: [room], symbols: [bed] };

    const offset = smartRoomLabelOffset(room, [bed], []);
    expect(offset.y).not.toBe(0); // the bed actually shifted the label

    const shapes = docToShapes(doc, { showDims: false, showLabels: true });
    const nameText = shapes.find((s): s is Extract<Shape, { kind: 'text' }> => s.kind === 'text' && s.text === 'Bedroom');
    expect(nameText).toBeDefined();
    // Export label sits at room-centre + smart offset (name line offset scales
    // with the R18 shrink factor k) — the same place the canvas draws it.
    const k = nameText!.size / 260;
    expect(nameText!.y).toBeCloseTo(room.y + room.h / 2 + offset.y - 130 * k, 3);
  });
});

describe('polygon room area helpers stay consistent', () => {
  it('area of an L outline matches shoelace', () => {
    const lRing: Point[] = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 2000, y: 2000 },
      { x: 2000, y: 4000 },
      { x: 0, y: 4000 },
    ];
    // 4000x2000 + 2000x2000 = 12,000,000 mm²
    expect(polygonAreaMm2(lRing)).toBeCloseTo(12_000_000, 0);
  });
});
