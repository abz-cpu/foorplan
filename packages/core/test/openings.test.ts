import { describe, expect, it } from 'vitest';
import {
  clampOpeningOffset,
  distanceToWall,
  doorSwingGeometry,
  nearestOffsetOnWall,
  nearestWall,
  openingJambs,
  pointAlongWall,
  wallDirection,
  wallSegments,
} from '../src/openings';
import { addWall, emptyFloorDoc } from '../src/doc';
import type { Opening, Wall } from '../src/types';

const wall: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
const door: Opening = { id: 'o1', wallId: 'w1', kind: 'door', offsetMm: 1000, widthMm: 800, hinge: 'left' };

describe('wall projection helpers', () => {
  it('direction and points along the wall', () => {
    expect(wallDirection(wall)).toEqual({ x: 1, y: 0 });
    expect(pointAlongWall(wall, 1500)).toEqual({ x: 1500, y: 0 });
  });

  it('projects points onto the wall with clamping', () => {
    expect(nearestOffsetOnWall(wall, { x: 1200, y: 300 })).toBe(1200);
    expect(nearestOffsetOnWall(wall, { x: -500, y: 50 })).toBe(0);
    expect(nearestOffsetOnWall(wall, { x: 9000, y: 0 })).toBe(4000);
  });

  it('measures perpendicular distance', () => {
    expect(distanceToWall(wall, { x: 2000, y: 250 })).toBe(250);
    expect(distanceToWall(wall, { x: 5000, y: 0 })).toBe(1000); // beyond the end
  });
});

describe('opening placement', () => {
  it('clamps the opening to stay fully on the wall', () => {
    expect(clampOpeningOffset(wall, 100, 800)).toBe(400);
    expect(clampOpeningOffset(wall, 3900, 800)).toBe(3600);
    expect(clampOpeningOffset(wall, 2000, 800)).toBe(2000);
    // opening wider than the wall centres on it
    expect(clampOpeningOffset({ ...wall, b: { x: 600, y: 0 } }, 300, 800)).toBe(300);
  });

  it('computes jamb points', () => {
    const { start, end } = openingJambs(wall, door);
    expect(start).toEqual({ x: 600, y: 0 });
    expect(end).toEqual({ x: 1400, y: 0 });
  });
});

describe('doorSwingGeometry', () => {
  it('swings toward wallNormal by default (swingSide unset / "a")', () => {
    const g = doorSwingGeometry(wall, door);
    expect(g.hinge).toEqual({ x: 600, y: 0 });
    expect(g.tip).toEqual({ x: 600, y: 800 });
  });

  it('swings to the opposite side when swingSide is "b"', () => {
    const g = doorSwingGeometry(wall, { ...door, swingSide: 'b' });
    expect(g.hinge).toEqual({ x: 600, y: 0 });
    expect(g.tip).toEqual({ x: 600, y: -800 });
  });

  it('flipping hinge keeps the same swing side but moves the hinge point', () => {
    const g = doorSwingGeometry(wall, { ...door, hinge: 'right' });
    expect(g.hinge).toEqual({ x: 1400, y: 0 });
    expect(g.tip).toEqual({ x: 1400, y: 800 });
  });
});

describe('wallSegments', () => {
  it('subtracts openings from the wall', () => {
    const segs = wallSegments(wall, [door]);
    expect(segs).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } },
      { a: { x: 1400, y: 0 }, b: { x: 4000, y: 0 } },
    ]);
  });

  it('handles multiple and edge-touching openings', () => {
    const win: Opening = { id: 'o2', wallId: 'w1', kind: 'window', offsetMm: 3600, widthMm: 800, hinge: 'left' };
    const segs = wallSegments(wall, [door, win]);
    expect(segs).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } },
      { a: { x: 1400, y: 0 }, b: { x: 3200, y: 0 } },
    ]);
  });

  it('returns the full wall when there are no openings', () => {
    expect(wallSegments(wall, [])).toEqual([{ a: wall.a, b: wall.b }]);
  });
});

describe('nearestWall', () => {
  it('finds the closest wall within tolerance', () => {
    const doc = addWall(
      addWall(emptyFloorDoc(), wall),
      { id: 'w2', a: { x: 0, y: 2000 }, b: { x: 4000, y: 2000 }, thickness: 100 },
    );
    const hit = nearestWall(doc, { x: 1000, y: 1800 }, 400);
    expect(hit?.wall.id).toBe('w2');
    expect(hit?.offsetMm).toBe(1000);
    expect(nearestWall(doc, { x: 1000, y: 1000 }, 400)).toBeNull();
  });
});
