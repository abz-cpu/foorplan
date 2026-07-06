import { describe, expect, it } from 'vitest';
import {
  orthoSnap,
  snapPointToGrid,
  snapToNearestPoint,
  snapValueToGrid,
  snapWallEnd,
} from '../src/snapping';

describe('grid snapping', () => {
  it('rounds to the nearest grid line', () => {
    expect(snapValueToGrid(149, 100)).toBe(100);
    expect(snapValueToGrid(150, 100)).toBe(200);
    expect(snapValueToGrid(-149, 100)).toBe(-100);
    expect(snapPointToGrid({ x: 3049, y: 951 }, 100)).toEqual({ x: 3000, y: 1000 });
  });
});

describe('endpoint snapping', () => {
  const candidates = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
  ];

  it('snaps to the nearest candidate within tolerance', () => {
    expect(snapToNearestPoint({ x: 3910, y: 40 }, candidates, 150)).toEqual({ x: 4000, y: 0 });
  });

  it('returns null when out of tolerance', () => {
    expect(snapToNearestPoint({ x: 2000, y: 2000 }, candidates, 150)).toBeNull();
  });
});

describe('ortho snapping', () => {
  const start = { x: 0, y: 0 };

  it('locks near-horizontal lines to the axis', () => {
    expect(orthoSnap(start, { x: 4000, y: 120 })).toEqual({ x: 4000, y: 0 });
    expect(orthoSnap(start, { x: -4000, y: -120 })).toEqual({ x: -4000, y: 0 });
  });

  it('locks near-vertical lines to the axis', () => {
    expect(orthoSnap(start, { x: -90, y: 3000 })).toEqual({ x: 0, y: 3000 });
  });

  it('leaves genuinely diagonal lines alone', () => {
    const end = { x: 3000, y: 2800 };
    expect(orthoSnap(start, end)).toEqual(end);
  });
});

describe('snapWallEnd pipeline', () => {
  it('prefers endpoint snap over grid', () => {
    const snapped = snapWallEnd(
      { x: 3960, y: 30 },
      { x: 0, y: 0 },
      { gridMm: 100, endpoints: [{ x: 3975, y: 25 }], endpointToleranceMm: 150 },
    );
    expect(snapped).toEqual({ x: 3975, y: 25 });
  });

  it('applies ortho then grid when no endpoint is near', () => {
    const snapped = snapWallEnd(
      { x: 4021, y: 96 },
      { x: 0, y: 0 },
      { gridMm: 100, endpoints: [], endpointToleranceMm: 150 },
    );
    expect(snapped).toEqual({ x: 4000, y: 0 });
  });

  it('grid-snaps the very first point (no start)', () => {
    const snapped = snapWallEnd({ x: 51, y: 49 }, null, {
      gridMm: 100,
      endpoints: [],
      endpointToleranceMm: 150,
    });
    expect(snapped).toEqual({ x: 100, y: 0 });
  });
});
