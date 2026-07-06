import { describe, expect, it } from 'vitest';
import {
  docBounds,
  floorGiaM2,
  polygonAreaMm2,
  polygonPerimeterMm,
  roomAreaM2,
  roomPerimeterM,
  wallLengthMm,
} from '../src/geometry';
import { emptyFloorDoc } from '../src/doc';
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
        room({ id: 'a', w: 4000, h: 3000 }), // 12 m²
        room({ id: 'b', w: 2000, h: 1500, includeInGia: false }), // excluded (stairs)
        room({ id: 'c', w: 1000, h: 1000 }), // 1 m²
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
