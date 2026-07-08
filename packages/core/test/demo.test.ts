import { describe, expect, it } from 'vitest';
import { buildDemoFloorDoc } from '../src/demo';

describe('buildDemoFloorDoc', () => {
  it('builds a walled, roomed, furnished sample flat', () => {
    const doc = buildDemoFloorDoc();
    expect(doc.walls).toHaveLength(5);
    expect(doc.rooms).toHaveLength(2);
    expect(doc.rooms.map((r) => r.name).sort()).toEqual(['Bedroom', 'Living Room']);
    expect(doc.openings).toHaveLength(2);
    expect(doc.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
    expect(doc.symbols).toHaveLength(2);
    expect(doc.symbols.map((s) => s.kind).sort()).toEqual(['bed-double', 'sofa']);
  });

  it('classifies the perimeter as external and the partition as internal', () => {
    const doc = buildDemoFloorDoc();
    const external = doc.walls.filter((w) => w.thickness === 200);
    const internal = doc.walls.filter((w) => w.thickness === 100);
    expect(external).toHaveLength(4);
    expect(internal).toHaveLength(1);
  });

  it('is deterministic in shape across calls (fresh ids each time)', () => {
    const a = buildDemoFloorDoc();
    const b = buildDemoFloorDoc();
    expect(a.walls).toHaveLength(b.walls.length);
    expect(a.walls[0].id).not.toBe(b.walls[0].id);
  });
});
