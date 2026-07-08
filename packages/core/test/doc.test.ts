import { describe, expect, it } from 'vitest';
import {
  addRoom,
  addWall,
  deleteEntities,
  deleteEntity,
  emptyFloorDoc,
  parseDoc,
  serializeDoc,
  updateRoom,
  wallEndpoints,
} from '../src/doc';
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
