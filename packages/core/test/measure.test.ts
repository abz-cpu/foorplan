import { describe, expect, it } from 'vitest';
import { floorFootprint } from '../src/measure';
import { buildRoomScheduleCsv } from '../src/csv';
import { emptyFloorDoc } from '../src/doc';
import type { FloorDoc, RoomRect } from '../src/types';

const room = (id: string, x: number, y: number, w: number, h: number, over: Partial<RoomRect> = {}): RoomRect => ({
  id,
  x,
  y,
  w,
  h,
  name: id,
  type: 'Bedroom',
  ceilingHeightM: 2.4,
  includeInGia: true,
  ...over,
});

describe('floorFootprint', () => {
  it('is zero for an empty floor', () => {
    expect(floorFootprint(emptyFloorDoc())).toEqual({ areaM2: 0, exposedPerimeterM: 0 });
  });

  it('measures a single room', () => {
    const doc: FloorDoc = { ...emptyFloorDoc(), rooms: [room('a', 0, 0, 4000, 3000)] };
    const fp = floorFootprint(doc);
    expect(fp.areaM2).toBeCloseTo(12, 5);
    expect(fp.exposedPerimeterM).toBeCloseTo(14, 5);
  });

  it('does not count shared edges between adjacent rooms', () => {
    // two 4x3 m rooms sharing a full vertical edge → one 8x3 m footprint
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [room('a', 0, 0, 4000, 3000), room('b', 4000, 0, 4000, 3000)],
    };
    const fp = floorFootprint(doc);
    expect(fp.areaM2).toBeCloseTo(24, 5);
    expect(fp.exposedPerimeterM).toBeCloseTo(22, 5);
  });

  it('does not double-count overlapping rooms', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [room('a', 0, 0, 4000, 3000), room('b', 2000, 0, 4000, 3000)],
    };
    const fp = floorFootprint(doc);
    expect(fp.areaM2).toBeCloseTo(18, 5); // 6m x 3m
    expect(fp.exposedPerimeterM).toBeCloseTo(18, 5);
  });
});

describe('buildRoomScheduleCsv', () => {
  it('includes rooms, per-floor totals, and heat-loss perimeter', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [
        room('Living Room', 0, 0, 4000, 3000),
        room('Stairs', 4000, 0, 2000, 3000, { type: 'Stairs', includeInGia: false }),
      ],
    };
    const csv = buildRoomScheduleCsv('14 Wolseley Road', [{ name: 'Ground Floor', doc }]);
    expect(csv).toContain('Property,14 Wolseley Road');
    expect(csv).toContain('Ground Floor,Living Room,Bedroom,4.00,3.00,12.00,2.40,Yes');
    expect(csv).toContain('Ground Floor,Stairs,Stairs,2.00,3.00,6.00,2.40,No');
    expect(csv).toContain('Gross internal area (m2),,,,12.00');
    expect(csv).toContain('Heat-loss perimeter (m),,,,18.00');
    expect(csv).toContain('TOTAL,Gross internal area (m2),,,,12.00');
  });

  it('escapes commas and quotes in names', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [room('Kitchen, "Diner"', 0, 0, 1000, 1000)],
    };
    const csv = buildRoomScheduleCsv('x', [{ name: 'GF', doc }]);
    expect(csv).toContain('"Kitchen, ""Diner"""');
  });
});
