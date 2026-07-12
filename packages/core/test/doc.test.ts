import { describe, expect, it } from 'vitest';
import {
  addRoom,
  addWall,
  autoClassifyWallThickness,
  copyPerimeterWalls,
  deleteEntities,
  deleteEntity,
  emptyFloorDoc,
  parseDoc,
  serializeDoc,
  setNorthAngle,
  updateRoom,
  wallEndpoints,
  wallsForRoom,
} from '../src/doc';
import { detectRooms } from '../src/detect';
import { docToThumbnailSvg } from '../src/thumbnail';
import type { RoomRect, Wall } from '../src/types';

const wall: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
const room: RoomRect = {
  id: 'r1',
  x: 0,
  y: 0,
  w: 3000,
  h: 2000,
  name: 'Bedroom',
  type: 'Bedroom',
  ceilingHeightM: 2.4,
  includeInGia: true,
};

describe('doc mutations are immutable', () => {
  it('addWall / addRoom / deleteEntity return new docs', () => {
    const d0 = emptyFloorDoc();
    const d1 = addWall(d0, wall);
    const d2 = addRoom(d1, room);
    expect(d0.walls).toHaveLength(0);
    expect(d1.walls).toHaveLength(1);
    expect(d2.rooms).toHaveLength(1);

    const d3 = deleteEntity(d2, 'w1');
    expect(d3.walls).toHaveLength(0);
    expect(d2.walls).toHaveLength(1);
  });

  it('updateRoom patches without touching siblings', () => {
    const d = addRoom(addRoom(emptyFloorDoc(), room), { ...room, id: 'r2' });
    const d2 = updateRoom(d, 'r2', { name: 'Office', includeInGia: false });
    expect(d2.rooms[0].name).toBe('Bedroom');
    expect(d2.rooms[1]).toMatchObject({ name: 'Office', includeInGia: false });
  });

  it('deleteEntities removes multiple ids across different entity types in one step', () => {
    const d = addRoom(addRoom(addWall(emptyFloorDoc(), wall), room), { ...room, id: 'r2' });
    const d2 = deleteEntities(d, ['w1', 'r2']);
    expect(d2.walls).toHaveLength(0);
    expect(d2.rooms).toEqual([room]);
    expect(d.walls).toHaveLength(1); // original untouched
  });

  it('deleteEntities with an empty list is a no-op (same reference)', () => {
    const d = addRoom(emptyFloorDoc(), room);
    expect(deleteEntities(d, [])).toBe(d);
  });
});

describe('setNorthAngle', () => {
  it('sets the angle', () => {
    expect(setNorthAngle(emptyFloorDoc(), 45).northAngleDeg).toBe(45);
  });

  it('wraps into [0, 360)', () => {
    expect(setNorthAngle(emptyFloorDoc(), 370).northAngleDeg).toBe(10);
    expect(setNorthAngle(emptyFloorDoc(), -15).northAngleDeg).toBe(345);
    expect(setNorthAngle(emptyFloorDoc(), -360).northAngleDeg).toBe(0);
  });
});

describe('copyPerimeterWalls', () => {
  it('keeps only exterior walls, drops the internal partition, rooms, and openings', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, { id: 'top', a: { x: 0, y: 0 }, b: { x: 8000, y: 0 }, thickness: 100 });
    doc = addWall(doc, { id: 'right', a: { x: 8000, y: 0 }, b: { x: 8000, y: 6000 }, thickness: 100 });
    doc = addWall(doc, { id: 'bottom', a: { x: 8000, y: 6000 }, b: { x: 0, y: 6000 }, thickness: 100 });
    doc = addWall(doc, { id: 'left', a: { x: 0, y: 6000 }, b: { x: 0, y: 0 }, thickness: 100 });
    doc = addWall(doc, { id: 'partition', a: { x: 4000, y: 0 }, b: { x: 4000, y: 6000 }, thickness: 100 });
    doc = { ...doc, rooms: detectRooms(doc) };
    expect(doc.rooms).toHaveLength(2); // sanity-check the fixture itself

    const next = copyPerimeterWalls(doc);
    expect(next.walls).toHaveLength(4);
    expect(next.rooms).toHaveLength(0);
    expect(next.openings).toHaveLength(0);
    expect(next.symbols).toHaveLength(0);
    expect(next.labels).toHaveLength(0);
    // fresh ids, not reused across floors
    expect(next.walls.map((w) => w.id)).not.toContain('top');
    // geometry preserved
    const topCopy = next.walls.find((w) => w.a.x === 0 && w.a.y === 0 && w.b.x === 8000);
    expect(topCopy).toBeDefined();
  });
});

describe('serialization', () => {
  it('round-trips', () => {
    const d = addRoom(addWall(emptyFloorDoc(), wall), room);
    expect(parseDoc(serializeDoc(d))).toEqual(d);
  });

  it('rejects unknown schema versions', () => {
    expect(() => parseDoc('{"schemaVersion":99}')).toThrow(/schema/i);
  });
});

describe('wallEndpoints', () => {
  it('lists both ends of every wall', () => {
    const d = addWall(emptyFloorDoc(), wall);
    expect(wallEndpoints(d)).toEqual([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
    ]);
  });
});

describe('docToThumbnailSvg', () => {
  it('renders walls and rooms scaled into the viewBox', () => {
    const svg = docToThumbnailSvg(addRoom(addWall(emptyFloorDoc(), wall), room));
    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('<rect');
  });

  it('renders an empty svg for an empty doc', () => {
    const svg = docToThumbnailSvg(emptyFloorDoc());
    expect(svg).not.toContain('<line');
  });
});

describe('wallsForRoom', () => {
  it('creates four walls around a room drawn in empty space, centrelines half-thickness outside', () => {
    const r: RoomRect = { ...room, x: 1000, y: 1000, w: 3000, h: 2000 };
    const walls = wallsForRoom(emptyFloorDoc(), r);
    expect(walls).toHaveLength(4);
    const top = walls.find((w) => w.a.y === w.b.y && w.a.y < 1000);
    expect(top?.a.y).toBe(950); // 1000 - 100/2
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    expect(Math.min(...xs)).toBe(950);
    expect(Math.max(...xs)).toBe(4050);
  });

  it('skips edges already covered by an existing wall (adjacent rooms share one wall)', () => {
    // Existing room 0..3000 with a wall along its right edge at x=3050
    const shared: Wall = { id: 'ws', a: { x: 3050, y: -50 }, b: { x: 3050, y: 2050 }, thickness: 100 };
    const d = addWall(emptyFloorDoc(), shared);
    // New room drawn to the right, snapped against the wall
    const r: RoomRect = { ...room, id: 'r2', x: 3100, y: 0, w: 2000, h: 2000 };
    const walls = wallsForRoom(d, r);
    expect(walls).toHaveLength(3); // left edge covered by the shared wall
    expect(walls.every((w) => Math.abs((w.a.x + w.b.x) / 2 - 3050) > 220 || w.a.y === w.b.y)).toBe(true);
  });
});

describe('autoClassifyWallThickness', () => {
  it('does nothing with no rooms to sample against', () => {
    const d = addWall(emptyFloorDoc(), { ...wall, thickness: 200 });
    expect(autoClassifyWallThickness(d).walls[0].thickness).toBe(200);
  });

  it('classifies boundary walls external and partitions internal, preserving custom values', () => {
    // Two rooms side by side sharing a partition at x=3000
    let d = emptyFloorDoc();
    const t = 100;
    const mk = (id: string, a: [number, number], b: [number, number], thickness = t): Wall => ({
      id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness,
    });
    d = addWall(d, mk('top', [0, 0], [6000, 0]));
    d = addWall(d, mk('bottom', [0, 4000], [6000, 4000]));
    d = addWall(d, mk('left', [0, 0], [0, 4000]));
    d = addWall(d, mk('right', [6000, 0], [6000, 4000]));
    d = addWall(d, mk('mid', [3000, 0], [3000, 4000]));
    d = addWall(d, mk('custom', [1500, 0], [1500, 4000], 150)); // user-typed custom
    d = addRoom(d, { ...room, id: 'ra', x: 50, y: 50, w: 2900, h: 3900 });
    d = addRoom(d, { ...room, id: 'rb', x: 3050, y: 50, w: 2900, h: 3900 });
    const out = autoClassifyWallThickness(d);
    const th = (id: string) => out.walls.find((w) => w.id === id)?.thickness;
    expect(th('top')).toBe(200);
    expect(th('left')).toBe(200);
    expect(th('right')).toBe(200);
    expect(th('bottom')).toBe(200);
    expect(th('mid')).toBe(100);
    expect(th('custom')).toBe(150); // untouched
  });
});
