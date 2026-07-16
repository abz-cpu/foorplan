import { describe, expect, it } from 'vitest';
import { addOpening, addRoom, addWall, emptyFloorDoc } from '../src/doc';
import { docToShapes, openingRenderCtx, openingShapes, stairShapes, ROOM_ZONE_COLORS } from '../src/shapes';
import type { Opening, RoomRect, Wall } from '../src/types';

const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
const door: Opening = { id: 'd', wallId: 'w', kind: 'door', offsetMm: 2000, widthMm: 900, hinge: 'left' };
const room = (over: Partial<RoomRect> = {}): RoomRect => ({
  id: 'r', x: 0, y: 50, w: 4000, h: 3000, name: 'Lounge', type: 'Lounge',
  ceilingHeightM: 2.4, includeInGia: true, ...over,
});

describe('door threshold fill', () => {
  it('paints the door gap with the adjacent room colour in presentation mode', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall);
    doc = addRoom(doc, room());
    doc = addOpening(doc, door);
    const ctx = openingRenderCtx(doc, wall, door, 'presentation');
    expect(ctx.thresholdFill).toBe(ROOM_ZONE_COLORS.Lounge.fill);
    const shapes = openingShapes(wall, door, ctx);
    const threshold = shapes.find((s) => s.kind === 'polyline' && s.closed && s.fill === ROOM_ZONE_COLORS.Lounge.fill);
    expect(threshold).toBeDefined();
  });
  it('uses white in technical mode', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall);
    doc = addRoom(doc, room());
    doc = addOpening(doc, door);
    expect(openingRenderCtx(doc, wall, door, 'technical').thresholdFill).toBe('#FFFFFF');
  });
});

describe('window styles', () => {
  const win: Opening = { id: 'n', wallId: 'w', kind: 'window', offsetMm: 2000, widthMm: 1200, hinge: 'left' };
  it('bay windows project outward as a 4-point polygon away from the room', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall);
    doc = addRoom(doc, room()); // room is below the wall (y>0) → outward = up (negative y)
    const ctx = openingRenderCtx(doc, wall, { ...win, windowStyle: 'bay' });
    const shapes = openingShapes(wall, { ...win, windowStyle: 'bay' }, ctx);
    const proj = shapes.find((s) => s.kind === 'polyline' && s.closed && s.fill === '#FFFFFF');
    expect(proj).toBeDefined();
    if (proj && proj.kind === 'polyline') {
      const ys = proj.points.map((p) => p.y);
      expect(Math.min(...ys)).toBeLessThan(-300); // bumps out on the roomless side
    }
  });
  it('box windows project as a rectangle', () => {
    const shapes = openingShapes(wall, { ...win, windowStyle: 'box' }, { outwardSign: -1 });
    const proj = shapes.find((s) => s.kind === 'polyline' && s.closed && s.fill === '#FFFFFF');
    expect(proj).toBeDefined();
    if (proj && proj.kind === 'polyline') expect(proj.points.length).toBe(4);
  });
});

describe('door styles', () => {
  it('double doors draw two leaves and two arcs', () => {
    const shapes = openingShapes(wall, { ...door, doorStyle: 'double' }, {});
    expect(shapes.filter((s) => s.kind === 'arc').length).toBe(2);
    expect(shapes.filter((s) => s.kind === 'line').length).toBe(2);
  });
  it('sliding doors draw panels and no arcs', () => {
    const shapes = openingShapes(wall, { ...door, doorStyle: 'sliding' }, {});
    expect(shapes.some((s) => s.kind === 'arc')).toBe(false);
    expect(shapes.filter((s) => s.kind === 'line').length).toBeGreaterThanOrEqual(3);
  });
});

describe('stair styles', () => {
  const stairs = room({ id: 's', type: 'Stairs', name: 'Stairs', w: 1000, h: 3000, includeInGia: false });
  it('spiral renders a circle with radials', () => {
    const shapes = stairShapes({ ...stairs, stairStyle: 'spiral' });
    expect(shapes.filter((s) => s.kind === 'arc').length).toBe(2);
    expect(shapes.filter((s) => s.kind === 'line').length).toBe(12);
  });
  it('uturn renders a divider, treads on both flights, and a U arrow', () => {
    const shapes = stairShapes({ ...stairs, stairStyle: 'uturn' });
    expect(shapes.filter((s) => s.kind === 'polyline').length).toBe(2); // U + arrowhead
  });
  it('straight remains the default', () => {
    const straight = stairShapes(stairs);
    expect(straight.filter((s) => s.kind === 'polyline').length).toBe(1); // arrowhead only
  });
});

describe('printed-size override + heading labels', () => {
  it('room label dims line uses the override', () => {
    let doc = emptyFloorDoc();
    doc = addRoom(doc, room({ displayWMm: 3620, displayLMm: 4200 }));
    const texts = docToShapes(doc, { showDims: false })
      .filter((s): s is Extract<typeof s, { kind: 'text' }> => s.kind === 'text')
      .map((s) => s.text);
    expect(texts).toContain('3.62 × 4.20 m');
  });
  it('heading labels render bigger and bolder', () => {
    let doc = emptyFloorDoc();
    doc = { ...doc, labels: [{ id: 'l', x: 0, y: 0, text: 'Ground Floor', heading: true }] };
    const t = docToShapes(doc, { showDims: false }).find(
      (s): s is Extract<typeof s, { kind: 'text' }> => s.kind === 'text' && s.text === 'Ground Floor',
    );
    expect(t?.size).toBe(400);
    expect(t?.weight).toBe(700);
  });
});
