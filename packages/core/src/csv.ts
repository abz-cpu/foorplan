import { roomAreaM2 } from './geometry';
import { floorFootprint, floorGiaM2 } from './measure';
import { SURVEY_SCHEMA, type PropertySurvey } from './survey';
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

/**
 * EPC-focused CSV for Domestic Energy Assessors: one row per habitable room
 * (stairs and other assets are excluded), with the exact columns an RdSAP
 * workflow wants, plus per-floor GIA and heat-loss perimeter totals.
 */
export function buildEpcCsv(
  propertyName: string,
  floors: FloorForSchedule[],
  survey?: PropertySurvey,
): string {
  const rows: (string | number)[][] = [];
  rows.push(['Property', propertyName]);
  rows.push(['Generated', new Date().toISOString().slice(0, 10)]);
  rows.push([]);
  rows.push([
    'Floor',
    'Room Name',
    'Room Type',
    'Gross Internal Area (m2)',
    'Ceiling Height (m)',
    'Heat-loss Perimeter (m)',
  ]);

  for (const floor of floors) {
    const fp = floorFootprint(floor.doc);
    for (const r of floor.doc.rooms) {
      if (r.type === 'Stairs') continue; // assets, not rooms
      rows.push([
        floor.name,
        r.name,
        r.type,
        r.includeInGia ? roomAreaM2(r).toFixed(2) : '0.00',
        r.ceilingHeightM.toFixed(2),
        '', // perimeter is a floor-level figure; see the floor total row
      ]);
    }
    rows.push([
      floor.name,
      'FLOOR TOTAL',
      '',
      floorGiaM2(floor.doc).toFixed(2),
      '',
      fp.exposedPerimeterM.toFixed(2),
    ]);
    rows.push([]);
  }

  const totalGia = floors.reduce((a, f) => a + floorGiaM2(f.doc), 0);
  rows.push(['TOTAL', '', '', totalGia.toFixed(2), '', '']);

  // RdSAP survey block — only the fields the assessor actually filled in.
  if (survey) {
    const filled = SURVEY_SCHEMA.flatMap((group) =>
      group.fields
        .filter((f) => {
          const v = survey[f.key];
          return v !== undefined && String(v).trim() !== '';
        })
        .map((f) => [group.title, f.label, String(survey[f.key]) + (f.suffix ?? '')]),
    );
    if (filled.length > 0) {
      rows.push([]);
      rows.push(['RDSAP SURVEY']);
      rows.push(['Section', 'Item', 'Value']);
      rows.push(...filled);
    }
  }

  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
