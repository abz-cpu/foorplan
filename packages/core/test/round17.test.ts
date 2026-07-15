import { describe, expect, it } from 'vitest';
import { formatArea, formatAreaSqFt } from '../src/format';
import { PLAN_TEMPLATES } from '../src/templates';
import { classifyExternalWalls } from '../src/measure';
import { docToShapes } from '../src/shapes';
import { roomAreaM2 } from '../src/geometry';

describe('area units', () => {
  it('formats square feet as whole numbers', () => {
    expect(formatAreaSqFt(14.21)).toBe('153 ft²');
  });
  it('formats m², ft², and both', () => {
    expect(formatArea(14.21, 'm2')).toBe('14.2 m²');
    expect(formatArea(14.21, 'ft2')).toBe('153 ft²');
    expect(formatArea(14.21, 'both')).toBe('14.2 m² · 153 ft²');
  });
  it('docToShapes room labels honour areaUnits', () => {
    const doc = {
      schemaVersion: 1 as const,
      walls: [],
      openings: [],
      symbols: [],
      labels: [],
      rooms: [
        {
          id: 'r',
          x: 0,
          y: 0,
          w: 4000,
          h: 3000,
          name: 'Room',
          type: 'Other' as const,
          ceilingHeightM: 2.4,
          includeInGia: true,
        },
      ],
    };
    const texts = docToShapes(doc, { showDims: false, areaUnits: 'ft2' })
      .filter((s): s is Extract<(typeof s), { kind: 'text' }> => s.kind === 'text')
      .map((s) => s.text);
    expect(texts.some((t) => /ft²/.test(t))).toBe(true);
    expect(texts.some((t) => /m²/.test(t))).toBe(false);
  });
});

describe('plan templates', () => {
  it('every template builds floors with named rooms and enclosed walls', () => {
    for (const tpl of PLAN_TEMPLATES) {
      const floors = tpl.buildFloors();
      expect(floors.length).toBeGreaterThan(0);
      for (const floor of floors) {
        expect(floor.doc.rooms.length).toBeGreaterThan(0);
        expect(floor.doc.walls.length).toBeGreaterThanOrEqual(4);
        // No leftover "Room N" placeholders — every room got a real name.
        for (const room of floor.doc.rooms) {
          expect(room.name).not.toMatch(/^Room \d+$/);
        }
        // Boundary walls classified external (auto thickness ran).
        const external = classifyExternalWalls(floor.doc);
        expect(external.size).toBeGreaterThan(0);
      }
    }
  });

  it('template GIA magnitudes are in the advertised ballpark', () => {
    const areas = Object.fromEntries(
      PLAN_TEMPLATES.map((t) => [
        t.id,
        t.buildFloors().reduce(
          (sum, f) => sum + f.doc.rooms.reduce((s, r) => s + roomAreaM2(r), 0),
          0,
        ),
      ]),
    );
    expect(areas['studio-flat']).toBeGreaterThan(25);
    expect(areas['studio-flat']).toBeLessThan(40);
    expect(areas['two-bed-terrace']).toBeGreaterThan(60);
    expect(areas['two-bed-terrace']).toBeLessThan(90);
    expect(areas['three-bed-semi']).toBeGreaterThan(100);
    expect(areas['three-bed-semi']).toBeLessThan(140);
  });

  it('ground floors have a front door', () => {
    for (const tpl of PLAN_TEMPLATES) {
      const ground = tpl.buildFloors()[0];
      expect(ground.doc.openings.some((o) => o.kind === 'door')).toBe(true);
    }
  });
});
