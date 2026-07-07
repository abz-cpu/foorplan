import { describe, expect, it } from 'vitest';
import { docToShapes, transformShapes } from '../src/shapes';
import { addOpening, addRoom, addWall, emptyFloorDoc } from '../src/doc';
import type { Opening, RoomRect, Wall } from '../src/types';

const wall: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
const door: Opening = { id: 'o1', wallId: 'w1', kind: 'door', offsetMm: 1000, widthMm: 800, hinge: 'left' };
const window_: Opening = { id: 'o2', wallId: 'w1', kind: 'window', offsetMm: 3000, widthMm: 1000, hinge: 'left' };
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

describe('docToShapes', () => {
  it('splits walls around openings and emits door arcs + window lines', () => {
    const doc = addOpening(addOpening(addWall(emptyFloorDoc(), wall), door), window_);
    const shapes = docToShapes(doc, { showDims: false });
    const wallLines = shapes.filter((s) => s.kind === 'line' && s.width === wall.thickness);
    expect(wallLines).toHaveLength(3); // wall cut into 3 segments by 2 openings
    expect(shapes.some((s) => s.kind === 'arc')).toBe(true); // door swing
  });

  it('emits stair treads and room labels', () => {
    const doc = addRoom(
      addRoom(emptyFloorDoc(), room),
      { ...room, id: 'r2', x: 3000, type: 'Stairs', name: 'Stairs', includeInGia: false },
    );
    const shapes = docToShapes(doc, { showDims: false });
    const texts = shapes.filter((s) => s.kind === 'text').map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toContain('Bedroom');
    expect(texts).not.toContain('Stairs'); // stairs draw treads, not labels
    expect(shapes.filter((s) => s.kind === 'polyline')).toHaveLength(1); // direction arrow
  });

  it('adds overall dimension lines when requested', () => {
    const doc = addRoom(emptyFloorDoc(), room);
    const withDims = docToShapes(doc, { showDims: true });
    const withoutDims = docToShapes(doc, { showDims: false });
    expect(withDims.length).toBeGreaterThan(withoutDims.length);
    expect(withDims.some((s) => s.kind === 'text' && s.rotateDeg === -90)).toBe(true);
  });
});

describe('transformShapes', () => {
  it('scales coordinates, widths, and text sizes', () => {
    const doc = addRoom(emptyFloorDoc(), room);
    const [rect] = transformShapes(docToShapes(doc, { showDims: false }), 0.1, 5, 7);
    expect(rect).toMatchObject({ kind: 'rect', x: 5, y: 7, w: 300, h: 200 });
  });
});
