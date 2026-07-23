import { describe, expect, it } from 'vitest';
import { addRoom, addWall, emptyFloorDoc } from '../src/doc';
import {
  clampPointInsidePolygon,
  isClosingPoint,
  nearestPointOnSegment,
  roomContainingPoint,
  snapPointToWall,
  STANDARD_ROOM_HEIGHT_M,
} from '../src/partition';
import type { RoomRect, Wall } from '../src/types';

// A 7130 × 3360 room (matches the reference plan) with its four perimeter walls
// on the room-rect edges.
const room: RoomRect = {
  id: 'r1',
  x: 0,
  y: 0,
  w: 7130,
  h: 3360,
  name: 'Room 1',
  type: 'Other',
  ceilingHeightM: 2.4,
  includeInGia: true,
};

const mkWall = (id: string, a: [number, number], b: [number, number]): Wall => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness: 100,
});

function plan() {
  let d = addRoom(emptyFloorDoc(), room);
  d = addWall(d, mkWall('top', [0, 0], [7130, 0]));
  d = addWall(d, mkWall('bottom', [0, 3360], [7130, 3360]));
  d = addWall(d, mkWall('left', [0, 0], [0, 3360]));
  d = addWall(d, mkWall('right', [7130, 0], [7130, 3360]));
  return d;
}

describe('roomContainingPoint', () => {
  it('finds the room for an interior point', () => {
    expect(roomContainingPoint(plan(), { x: 3500, y: 1500 })?.id).toBe('r1');
  });

  it('returns undefined for a point outside every room', () => {
    expect(roomContainingPoint(plan(), { x: -500, y: 1500 })).toBeUndefined();
  });

  it('ignores stairs rooms', () => {
    const d = addRoom(plan(), { ...room, id: 'st', type: 'Stairs', x: 3000, y: 1000, w: 1000, h: 1000 });
    // The point sits inside both the room and the stairs; stairs are skipped, so
    // the enclosing habitable room is returned.
    expect(roomContainingPoint(d, { x: 3500, y: 1500 })?.id).toBe('r1');
  });
});

describe('clampPointInsidePolygon', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 7130, y: 0 },
    { x: 7130, y: 3360 },
    { x: 0, y: 3360 },
  ];

  it('leaves an interior point untouched', () => {
    expect(clampPointInsidePolygon({ x: 3000, y: 1500 }, ring)).toEqual({ x: 3000, y: 1500 });
  });

  it('pulls an outside point back inside the polygon', () => {
    const p = clampPointInsidePolygon({ x: 8000, y: 1500 }, ring);
    expect(p.x).toBeLessThanOrEqual(7130);
    expect(p.x).toBeGreaterThan(7000);
    // The clamped point must actually be inside.
    expect(p.x > 0 && p.x < 7130 && p.y > 0 && p.y < 3360).toBe(true);
  });
});

describe('nearestPointOnSegment', () => {
  it('projects perpendicularly and clamps to the segment', () => {
    expect(nearestPointOnSegment({ x: 3000, y: 500 }, { x: 0, y: 0 }, { x: 7130, y: 0 })).toEqual({
      x: 3000,
      y: 0,
    });
    // Beyond the far end clamps to b.
    expect(nearestPointOnSegment({ x: 9000, y: 500 }, { x: 0, y: 0 }, { x: 7130, y: 0 })).toEqual({
      x: 7130,
      y: 0,
    });
  });
});

describe('snapPointToWall', () => {
  it('snaps to the bottom wall and reports face-adjusted corner gaps', () => {
    // A partition centreline at x=3500 on the bottom wall, thickness 100 →
    // gaps to the corners are 3450 (left) and 3580 (right); together with the
    // 100mm thickness they sum to the 7130 wall length (matches the reference).
    const snap = snapPointToWall(plan(), { x: 3500, y: 3340 }, 200, 100);
    expect(snap).not.toBeNull();
    expect(snap!.wall.id).toBe('bottom');
    expect(snap!.point).toEqual({ x: 3500, y: 3360 });
    expect(snap!.leftMm).toBeCloseTo(3450, 5);
    expect(snap!.rightMm).toBeCloseTo(3580, 5);
    expect(snap!.leftMm + 100 + snap!.rightMm).toBeCloseTo(7130, 5);
  });

  it('returns null when no wall is within tolerance', () => {
    expect(snapPointToWall(plan(), { x: 3500, y: 1500 }, 200, 100)).toBeNull();
  });
});

describe('isClosingPoint', () => {
  const chain = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
  ];
  it('closes when back near the first point with >=3 vertices', () => {
    expect(isClosingPoint(chain, { x: 40, y: 30 }, 100)).toBe(true);
  });
  it('does not close with fewer than 3 vertices', () => {
    expect(isClosingPoint(chain.slice(0, 2), { x: 0, y: 0 }, 100)).toBe(false);
  });
  it('does not close when far from the start', () => {
    expect(isClosingPoint(chain, { x: 2000, y: 2000 }, 100)).toBe(false);
  });
});

describe('STANDARD_ROOM_HEIGHT_M', () => {
  it('is the documented residential default', () => {
    expect(STANDARD_ROOM_HEIGHT_M).toBe(2.735);
  });
});
