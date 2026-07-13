import { describe, expect, it } from 'vitest';
import { addRoom, addWall, emptyFloorDoc, wallsForPolygon } from '../src/doc';
import { detectRooms } from '../src/detect';
import { insetPolygonVariable } from '../src/faces';
import { classifyExternalWalls } from '../src/measure';
import { polygonAreaMm2 } from '../src/geometry';
import { docToShapes, type Shape } from '../src/shapes';
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
