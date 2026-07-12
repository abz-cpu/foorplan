import { describe, expect, it } from 'vitest';
import { classifyExternalWalls, floorFootprint, floorGiaM2 } from '../src/measure';
import { buildRoomScheduleCsv } from '../src/csv';
import { addRoom, addWall, emptyFloorDoc } from '../src/doc';
import { detectRooms } from '../src/detect';
import type { FloorDoc, RoomRect, Wall } from '../src/types';

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

describe('classifyExternalWalls', () => {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 100,
  });

  it('marks the perimeter external and the shared partition internal', () => {
    // Two 4x3m rooms side by side -> one 8x3m footprint with a partition wall down the middle.
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [room('a', 0, 0, 4000, 3000), room('b', 4000, 0, 4000, 3000)],
      walls: [
        wall('top', 0, 0, 8000, 0),
        wall('bottom', 0, 3000, 8000, 3000),
        wall('left', 0, 0, 0, 3000),
        wall('right', 8000, 0, 8000, 3000),
        wall('partition', 4000, 0, 4000, 3000),
      ],
    };
    const external = classifyExternalWalls(doc);
    expect(external.has('top')).toBe(true);
    expect(external.has('bottom')).toBe(true);
    expect(external.has('left')).toBe(true);
    expect(external.has('right')).toBe(true);
    expect(external.has('partition')).toBe(false);
  });

  it('returns an empty set when there are no rooms', () => {
    const doc: FloorDoc = { ...emptyFloorDoc(), walls: [wall('a', 0, 0, 1000, 0)] };
    expect(classifyExternalWalls(doc).size).toBe(0);
  });

  it('classifies correctly against detectRooms output, where adjacent rooms are inset from wall centrelines and never actually touch', () => {
    // Regression test: detectRooms insets each room by half the bounding
    // wall's thickness (so GIA excludes wall thickness), which means two
    // rooms either side of a shared internal wall always leave a gap at
    // that wall — a naive room-union-boundary match would misclassify the
    // partition as external and, worse, misclassify true perimeter walls
    // as internal whenever a wall's exact midpoint lands in that gap.
    let doc: FloorDoc = emptyFloorDoc();
    doc = addWall(doc, { id: 'top', a: { x: -2900, y: -3800 }, b: { x: 5500, y: -3800 }, thickness: 100 });
    doc = addWall(doc, { id: 'right', a: { x: 5500, y: -3800 }, b: { x: 5500, y: 2100 }, thickness: 100 });
    doc = addWall(doc, { id: 'bottom', a: { x: 5500, y: 2100 }, b: { x: -2900, y: 2100 }, thickness: 100 });
    doc = addWall(doc, { id: 'left', a: { x: -2900, y: 2100 }, b: { x: -2900, y: -3800 }, thickness: 100 });
    // Deliberately placed near the horizontal midpoint of top/bottom, the
    // exact condition that broke the earlier boundary-matching approach.
    doc = addWall(doc, { id: 'partition', a: { x: 1300, y: -3800 }, b: { x: 1300, y: 2100 }, thickness: 100 });
    doc = { ...doc, rooms: detectRooms(doc) };
    expect(doc.rooms).toHaveLength(2);

    const external = classifyExternalWalls(doc);
    expect(external).toEqual(new Set(['top', 'right', 'bottom', 'left']));
    expect(external.has('partition')).toBe(false);
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

describe('floorGiaM2 to internal wall faces', () => {
  it('measures a 6x5m plan (200mm external walls) to ~27.84 m2, including the internal partition', () => {
    let d = emptyFloorDoc();
    const mk = (id: string, a: [number, number], b: [number, number], t: number): Wall => ({
      id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: t,
    });
    // 6x5 external perimeter (200mm) + one internal partition (100mm)
    d = addWall(d, mk('top', [0, 0], [6000, 0], 200));
    d = addWall(d, mk('right', [6000, 0], [6000, 5000], 200));
    d = addWall(d, mk('bottom', [6000, 5000], [0, 5000], 200));
    d = addWall(d, mk('left', [0, 5000], [0, 0], 200));
    d = addWall(d, mk('mid', [3000, 0], [3000, 5000], 100));
    // rooms inset to the internal faces (x 100..2950 / 3050..5900, y 100..4900)
    d = addRoom(d, room('lr', 100, 100, 2850, 4800));
    d = addRoom(d, room('br', 3050, 100, 2850, 4800));
    // internal envelope = 5800 x 4800 = 27.84 m2 (partition included)
    expect(floorGiaM2(d)).toBeCloseTo(27.84, 1);
  });

  it('subtracts a room explicitly excluded from GIA (e.g. integral garage)', () => {
    let d = emptyFloorDoc();
    const mk = (id: string, a: [number, number], b: [number, number], t: number): Wall => ({
      id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: t,
    });
    d = addWall(d, mk('top', [0, 0], [6000, 0], 200));
    d = addWall(d, mk('right', [6000, 0], [6000, 5000], 200));
    d = addWall(d, mk('bottom', [6000, 5000], [0, 5000], 200));
    d = addWall(d, mk('left', [0, 5000], [0, 0], 200));
    d = addRoom(d, room('living', 100, 100, 5800, 3000));
    d = addRoom(d, room('garage', 100, 3100, 5800, 1800, { includeInGia: false })); // 10.44 m2 excluded
    const full = 5800 * 4800 / 1e6; // 27.84
    const garage = 5800 * 1800 / 1e6; // 10.44
    expect(floorGiaM2(d)).toBeCloseTo(full - garage, 1);
  });

  it('falls back to room union when there is no enclosing wall loop', () => {
    let d = emptyFloorDoc();
    d = addRoom(d, room('a', 0, 0, 3000, 2000)); // 6 m2, no walls
    expect(floorGiaM2(d)).toBeCloseTo(6, 5);
  });
});
