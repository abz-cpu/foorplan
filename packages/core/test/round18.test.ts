import { describe, expect, it } from 'vitest';
import { wallBodyQuads } from '../src/walljoin';
import { scaleDocAxis, addWall, addRoom, emptyFloorDoc } from '../src/doc';
import { trimRoomOverlaps } from '../src/measure';
import { findRoomOverlaps, polygonAreaMm2, roomPolygon } from '../src/geometry';
import { roomTypeLabel, ROOM_TYPES } from '../src/types';
import { ROOM_ZONE_COLORS } from '../src/shapes';
import type { RoomRect, Wall } from '../src/types';

const W = (id: string, x1: number, y1: number, x2: number, y2: number, t = 100): Wall => ({
  id,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  thickness: t,
});

describe('wallBodyQuads (mitred joints)', () => {
  it('two collinear walls join with a flush perpendicular cut', () => {
    const a = W('a', 0, 0, 2000, 0);
    const b = W('b', 2000, 0, 4000, 0);
    const [quad] = wallBodyQuads(a, [a, b], []);
    // no corner sticks past x=2000 and none stops short
    const xs = quad.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(2000, 0);
  });

  it('a 45° joint mitres instead of overshooting', () => {
    const a = W('a', 0, 0, 2000, 0);
    const b = W('b', 2000, 0, 3500, 1500); // 45° down-right
    const [qa] = wallBodyQuads(a, [a, b], []);
    const [qb] = wallBodyQuads(b, [a, b], []);
    // the two walls share their mitre corners at the joint (seamless join)
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y) < 1;
    const shared = qa.filter((p) => qb.some((q) => near(p, q)));
    expect(shared.length).toBe(2);
    // and no corner of a overshoots wildly past the joint
    for (const p of qa) expect(p.x).toBeLessThan(2000 + a.thickness * 2.5 + 1);
  });

  it('a free end keeps the square-cap extension', () => {
    const a = W('a', 0, 0, 2000, 0);
    const [quad] = wallBodyQuads(a, [a], []);
    const xs = quad.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-50, 0); // extended by half thickness
    expect(Math.max(...xs)).toBeCloseTo(2050, 0);
  });

  it('door openings cut clean gaps', () => {
    const a = W('a', 0, 0, 4000, 0);
    const quads = wallBodyQuads(a, [a], [
      { id: 'd', wallId: 'a', kind: 'door', offsetMm: 2000, widthMm: 900, hinge: 'left' },
    ]);
    expect(quads.length).toBe(2);
  });
});

describe('scaleDocAxis', () => {
  it('scales one axis and keeps opening proportions', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, W('h', 0, 0, 4000, 0));
    doc = { ...doc, openings: [{ id: 'o', wallId: 'h', kind: 'door', offsetMm: 1000, widthMm: 800, hinge: 'left' }] };
    const scaled = scaleDocAxis(doc, 2, 1);
    expect(scaled.walls[0].b.x).toBe(8000);
    expect(scaled.walls[0].thickness).toBe(100); // untouched
    expect(scaled.openings[0].offsetMm).toBeCloseTo(2000, 3);
    expect(scaled.openings[0].widthMm).toBeCloseTo(1600, 3);
  });
});

describe('trimRoomOverlaps', () => {
  const room = (id: string, x: number, y: number, w: number, h: number): RoomRect => ({
    id, x, y, w, h, name: id, type: 'Other', ceilingHeightM: 2.4, includeInGia: true,
  });

  it('cuts the larger room around the smaller and clears the warning', () => {
    let doc = emptyFloorDoc();
    doc = addRoom(doc, room('big', 0, 0, 5000, 4000));
    doc = addRoom(doc, room('small', 4000, 3000, 2000, 2000)); // overlaps 1m x 1m
    expect(findRoomOverlaps(doc).length).toBe(1);
    const trimmed = trimRoomOverlaps(doc);
    expect(findRoomOverlaps(trimmed).length).toBe(0);
    const big = trimmed.rooms.find((r) => r.id === 'big')!;
    expect(polygonAreaMm2(roomPolygon(big))).toBeCloseTo(5000 * 4000 - 1000 * 1000, -3);
    const small = trimmed.rooms.find((r) => r.id === 'small')!;
    expect(small.w).toBe(2000); // the smaller room is untouched
  });
});

describe('room types round 18', () => {
  it('has Lounge and friends with zone colors', () => {
    for (const t of ['Lounge', 'Dining Room', 'Study', 'Conservatory', 'Garage', 'Porch'] as const) {
      expect(ROOM_TYPES).toContain(t);
      expect(ROOM_ZONE_COLORS[t]).toBeDefined();
    }
  });
  it('WC displays its full name', () => {
    expect(roomTypeLabel('WC')).toBe('WC / Toilet');
    expect(roomTypeLabel('Bedroom')).toBe('Bedroom');
  });
});
