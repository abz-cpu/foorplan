import { describe, expect, it } from 'vitest';
import { parseLengthToMm } from '../src/length';

describe('parseLengthToMm', () => {
  it('parses a bare number as metres', () => {
    expect(parseLengthToMm('4.2')).toBeCloseTo(4200, 5);
    expect(parseLengthToMm('4')).toBeCloseTo(4000, 5);
  });

  it('parses explicit mm/cm/m units', () => {
    expect(parseLengthToMm('4200mm')).toBeCloseTo(4200, 5);
    expect(parseLengthToMm('4200 mm')).toBeCloseTo(4200, 5);
    expect(parseLengthToMm('420cm')).toBeCloseTo(4200, 5);
    expect(parseLengthToMm('4.2m')).toBeCloseTo(4200, 5);
    expect(parseLengthToMm('4.2 m')).toBeCloseTo(4200, 5);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(parseLengthToMm('  4200MM  ')).toBeCloseTo(4200, 5);
  });

  it('parses feet and inches', () => {
    expect(parseLengthToMm("13'9\"")).toBeCloseTo((13 * 12 + 9) * 25.4, 3);
    expect(parseLengthToMm("13' 9\"")).toBeCloseTo((13 * 12 + 9) * 25.4, 3);
    expect(parseLengthToMm('13ft 9in')).toBeCloseTo((13 * 12 + 9) * 25.4, 3);
    expect(parseLengthToMm('13ft')).toBeCloseTo(13 * 12 * 25.4, 3);
    expect(parseLengthToMm("13'")).toBeCloseTo(13 * 12 * 25.4, 3);
  });

  it('returns null for garbage input', () => {
    expect(parseLengthToMm('')).toBeNull();
    expect(parseLengthToMm('abc')).toBeNull();
    expect(parseLengthToMm('4.2xyz')).toBeNull();
    expect(parseLengthToMm('-4')).toBeNull();
  });
});
