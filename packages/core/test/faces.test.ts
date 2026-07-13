import { describe, expect, it } from 'vitest';
import { detectWallFaces, insetPolygon, pointInPolygon } from '../src/faces';
import { polygonAreaMm2 } from '../src/geometry';
import type { Wall } from '../src/types';

let idc = 0;
const w = (ax: number, ay: number, bx: number, by: number): Wall => ({
  id: `w${idc++}`,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: 100,
});

describe('detectWallFaces', () => {
  it('finds one face for a simple rectangle', () => {
    const walls = [w(0, 0, 6000, 0), w(6000, 0, 6000, 5000), w(6000, 5000, 0, 5000), w(0, 5000, 0, 0)];
    const faces = detectWallFaces(walls);
    expect(faces).toHaveLength(1);
    expect(polygonAreaMm2(faces[0])).toBeCloseTo(30_000_000, -3);
  });

  it('finds two faces when split by an internal partition (T-junctions)', () => {
    const walls = [
      w(0, 0, 6000, 0),
      w(6000, 0, 6000, 5000),
      w(6000, 5000, 0, 5000),
      w(0, 5000, 0, 0),
      w(3000, 0, 3000, 5000), // partition, ends on the top & bottom wall spans
    ];
    const faces = detectWallFaces(walls);
    expect(faces).toHaveLength(2);
    for (const f of faces) expect(polygonAreaMm2(f)).toBeCloseTo(15_000_000, -3);
  });

  it('follows an angled (bay/chamfer) wall — a 5-sided room', () => {
    // rectangle with the bottom-right corner chamfered off
    const walls = [
      w(0, 0, 6000, 0),
      w(6000, 0, 6000, 3000),
      w(6000, 3000, 4000, 5000), // 45° chamfer
      w(4000, 5000, 0, 5000),
      w(0, 5000, 0, 0),
    ];
    const faces = detectWallFaces(walls);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toHaveLength(5); // pentagon, not a rectangle
    // area = full 30m² minus the 2x2m triangle cut off = 30 - 2 = 28 m²
    expect(polygonAreaMm2(faces[0])).toBeCloseTo(28_000_000, -4);
  });

  it('finds one L-shaped face', () => {
    // L: a 6x5 rectangle with a 3x2 bite out of the bottom-right
    const walls = [
      w(0, 0, 6000, 0),
      w(6000, 0, 6000, 3000),
      w(6000, 3000, 3000, 3000),
      w(3000, 3000, 3000, 5000),
      w(3000, 5000, 0, 5000),
      w(0, 5000, 0, 0),
    ];
    const faces = detectWallFaces(walls);
    expect(faces).toHaveLength(1);
    expect(polygonAreaMm2(faces[0])).toBeCloseTo(30_000_000 - 6_000_000, -4); // 24 m²
  });

  it('ignores a dangling wall that encloses nothing', () => {
    const walls = [
      w(0, 0, 6000, 0),
      w(6000, 0, 6000, 5000),
      w(6000, 5000, 0, 5000),
      w(0, 5000, 0, 0),
      w(1000, 1000, 1000, 3000), // free-floating stub inside
    ];
    const faces = detectWallFaces(walls);
    expect(faces).toHaveLength(1);
  });
});

describe('insetPolygon', () => {
  it('shrinks a rectangle inward by d on every side', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ];
    const inset = insetPolygon(rect, 50);
    expect(polygonAreaMm2(inset)).toBeCloseTo(900 * 900, -1);
  });
});

describe('pointInPolygon', () => {
  it('tests inside/outside for a triangle', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 10, y: 10 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 90, y: 90 }, tri)).toBe(false);
  });
});
