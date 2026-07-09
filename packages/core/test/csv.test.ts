import { describe, expect, it } from 'vitest';
import { buildEpcCsv } from '../src/csv';
import { addRoom, emptyFloorDoc } from '../src/doc';
import type { RoomRect } from '../src/types';

const room = (over: Partial<RoomRect>): RoomRect => ({
  id: over.id ?? 'r',
  x: 0,
  y: 0,
  w: 3000,
  h: 4000,
  name: 'Bedroom',
  type: 'Bedroom',
  ceilingHeightM: 2.4,
  includeInGia: true,
  ...over,
});

describe('buildEpcCsv', () => {
  it('emits one row per habitable room with the EPC columns and excludes stairs', () => {
    let doc = emptyFloorDoc();
    doc = addRoom(doc, room({ id: 'r1', name: 'Living Room', type: 'Living Room' }));
    doc = addRoom(doc, room({ id: 'r2', name: 'Bedroom', type: 'Bedroom', x: 3200 }));
    doc = addRoom(doc, room({ id: 's1', name: 'Stairs', type: 'Stairs', x: 6400, includeInGia: false }));

    const csv = buildEpcCsv('42 Sample Street', [{ name: 'Ground Floor', doc }]);
    const lines = csv.split('\r\n');

    const header = lines.find((l) => l.startsWith('Floor,Room Name'));
    expect(header).toBe(
      'Floor,Room Name,Room Type,Gross Internal Area (m2),Ceiling Height (m),Heat-loss Perimeter (m)',
    );
    expect(csv).toContain('Ground Floor,Living Room,Living Room,');
    expect(csv).toContain('Ground Floor,Bedroom,Bedroom,');
    // Stairs are assets, never a row
    expect(csv).not.toMatch(/Ground Floor,Stairs,Stairs/);
    // Floor total carries the heat-loss perimeter figure
    expect(csv).toMatch(/Ground Floor,FLOOR TOTAL,,/);
  });
});
