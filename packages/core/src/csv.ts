import { floorGiaM2, roomAreaM2 } from './geometry';
import { floorFootprint } from './measure';
import type { FloorDoc } from './types';

export interface FloorForSchedule {
  name: string;
  doc: FloorDoc;
}

function esc(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Room schedule CSV for a property — the measurement data EPC assessors
 * re-key into RdSAP tools: per-room dimensions/areas plus per-floor GIA,
 * footprint area, and heat-loss perimeter.
 */
export function buildRoomScheduleCsv(propertyName: string, floors: FloorForSchedule[]): string {
  const rows: (string | number)[][] = [];
  rows.push(['Property', propertyName]);
  rows.push(['Generated', new Date().toISOString().slice(0, 10)]);
  rows.push([]);
  rows.push(['Floor', 'Room', 'Type', 'Width (m)', 'Length (m)', 'Area (m2)', 'Ceiling (m)', 'In GIA']);

  for (const floor of floors) {
    for (const r of floor.doc.rooms) {
      rows.push([
        floor.name,
        r.name,
        r.type,
        (r.w / 1000).toFixed(2),
        (r.h / 1000).toFixed(2),
        roomAreaM2(r).toFixed(2),
        r.ceilingHeightM.toFixed(2),
        r.includeInGia ? 'Yes' : 'No',
      ]);
    }
    const fp = floorFootprint(floor.doc);
    rows.push([floor.name, 'Gross internal area (m2)', '', '', '', floorGiaM2(floor.doc).toFixed(2), '', '']);
    rows.push([floor.name, 'Footprint area (m2)', '', '', '', fp.areaM2.toFixed(2), '', '']);
    rows.push([floor.name, 'Heat-loss perimeter (m)', '', '', '', fp.exposedPerimeterM.toFixed(2), '', '']);
    rows.push([]);
  }

  const totalGia = floors.reduce((a, f) => a + floorGiaM2(f.doc), 0);
  rows.push(['TOTAL', 'Gross internal area (m2)', '', '', '', totalGia.toFixed(2), '', '']);

  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
