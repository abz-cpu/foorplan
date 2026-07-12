import { describe, expect, it } from 'vitest';
import {
  docBounds,
  findRoomOverlaps,
  polygonAreaMm2,
  polygonPerimeterMm,
  roomAreaM2,
  roomPerimeterM,
  wallLengthMm,
} from '../src/geometry';
import { floorGiaM2 } from '../src/measure';
import { addRoom, emptyFloorDoc } from '../src/doc';
import type { FloorDoc, RoomRect } from '../src/types';

const room = (over: Partial<RoomRect> = {}): RoomRect => ({
  id: 'r1',
  x: 0,
  y: 0,
  w: 4400,
  h: 3400,
  name: 'Living Room',
  type: 'Living Room',
  ceilingHeightM: 2.4,
  includeInGia: true,
  ...over,
});

describe('polygon geometry (shoelace)', () => {
  it('computes the area of a rectangle regardless of winding', () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    expect(polygonAreaMm2(cw)).toBe(12_000_000);
    expect(polygonAreaMm2([...cw].reverse())).toBe(12_000_000);
  });

  it('computes the area of an L-shaped room', () => {
    // 4m x 4m square with a 2m x 2m bite: 16 - 4 = 12 m²
    const l = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 2000, y: 2000 },
      { x: 2000, y: 4000 },
      { x: 0, y: 4000 },
    ];
    expect(polygonAreaMm2(l)).toBe(12_000_000);
    expect(polygonPerimeterMm(l)).toBe(16_000);
  });

  it('returns 0 for degenerate polygons', () => {
    expect(polygonAreaMm2([])).toBe(0);
    expect(
      polygonAreaMm2([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe(0);
  });
});

describe('room measurements', () => {
  it('area and perimeter in metres', () => {
    const r = room();
    expect(roomAreaM2(r)).toBeCloseTo(14.96, 5);
    expect(roomPerimeterM(r)).toBeCloseTo(15.6, 5);
  });
});

describe('floorGiaM2', () => {
  it('sums only rooms flagged for GIA inclusion', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [
        room({ id: 'a', x: 0, y: 0, w: 4000, h: 3000 }), // 12 m²
        room({ id: 'b', x: 0, y: 0, w: 2000, h: 1500, includeInGia: false }), // excluded (stairs)
        room({ id: 'c', x: 5000, y: 0, w: 1000, h: 1000 }), // 1 m², clear of room a
      ],
    };
    expect(floorGiaM2(doc)).toBeCloseTo(13, 5);
  });
});

describe('wallLengthMm / docBounds', () => {
  it('measures walls and bounds across walls and rooms', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      walls: [{ id: 'w1', a: { x: -1000, y: 0 }, b: { x: 3000, y: 3000 }, thickness: 100 }],
      rooms: [room({ x: 500, y: 500, w: 6000, h: 2000 })],
    };
    expect(wallLengthMm(doc.walls[0])).toBe(5000);
    expect(docBounds(doc)).toEqual({ minX: -1000, minY: 0, maxX: 6500, maxY: 3000 });
  });

  it('returns null bounds for an empty doc', () => {
    expect(docBounds(emptyFloorDoc())).toBeNull();
  });
});

describe('GIA union area and overlap detection', () => {
  const mkRoom = (id: string, x: number, y: number, w: number, h: number, over: Partial<RoomRect> = {}): RoomRect => ({
    id, x, y, w, h, name: id, type: 'Bedroom', ceilingHeightM: 2.4, includeInGia: true, ...over,
  });

  it('sums non-overlapping rooms normally', () => {
    let d = emptyFloorDoc();
    d = addRoom(d, mkRoom('a', 0, 0, 3000, 2000)); // 6 m2
    d = addRoom(d, mkRoom('b', 4000, 0, 2000, 2000)); // 4 m2
    expect(floorGiaM2(d)).toBeCloseTo(10, 5);
    expect(findRoomOverlaps(d)).toHaveLength(0);
  });

  it('counts overlapping floor area only once (no double count)', () => {
    let d = emptyFloorDoc();
    d = addRoom(d, mkRoom('big', 0, 0, 4000, 4000)); // 16 m2
    d = addRoom(d, mkRoom('small', 2000, 2000, 2000, 2000)); // 4 m2, fully inside big
    // plain sum would be 20; union is just the 16 m2 of the big room
    expect(floorGiaM2(d)).toBeCloseTo(16, 5);
    const overlaps = findRoomOverlaps(d);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].areaM2).toBeCloseTo(4, 5);
  });

  it('partial overlap: union is sum minus the shared area', () => {
    let d = emptyFloorDoc();
    d = addRoom(d, mkRoom('a', 0, 0, 3000, 3000)); // 9 m2
    d = addRoom(d, mkRoom('b', 2000, 2000, 3000, 3000)); // 9 m2, overlaps 1x1 m
    expect(floorGiaM2(d)).toBeCloseTo(17, 5); // 9 + 9 - 1
  });

  it('excludes rooms flagged out of GIA and Stairs from overlaps', () => {
    let d = emptyFloorDoc();
    d = addRoom(d, mkRoom('room', 0, 0, 4000, 4000));
    d = addRoom(d, mkRoom('stairs', 1000, 1000, 1000, 2000, { type: 'Stairs', includeInGia: false }));
    expect(floorGiaM2(d)).toBeCloseTo(16, 5);
    expect(findRoomOverlaps(d)).toHaveLength(0);
  });
});
