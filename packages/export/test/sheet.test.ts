import { describe, expect, it } from 'vitest';
import { emptyFloorDoc, type FloorDoc, type Wall } from '@floorplan/core';
import { buildFloorSheet, type SheetOptions } from '../src/sheet';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  thickness: 100,
});

/** A typical ~8m x 6m floor. */
function houseDoc(): FloorDoc {
  let doc = emptyFloorDoc();
  doc = { ...doc, walls: [
    wall('t', 0, 0, 8000, 0),
    wall('r', 8000, 0, 8000, 6000),
    wall('b', 0, 6000, 8000, 6000),
    wall('l', 0, 0, 0, 6000),
  ] };
  doc.rooms = [
    { id: 'r1', x: 100, y: 100, w: 7800, h: 5800, name: 'Living', type: 'Living Room', ceilingHeightM: 2.4, includeInGia: true },
  ];
  return doc;
}

const opts = (over: Partial<SheetOptions> = {}): SheetOptions => ({
  address: '1 Test Street',
  floorName: 'Ground Floor',
  paper: 'a4',
  orientation: 'landscape',
  showMeasurements: true,
  disclaimer: true,
  ...over,
});

/** Nice round scale-bar labels only ever read like "0.5 m" / "1 m" / "2 m",
 *  never a dimension label like "8.00 m". */
function scaleBarLabel(shapes: { kind: string; text?: string }[]): string | undefined {
  return shapes
    .filter((s) => s.kind === 'text')
    .map((s) => (s as { text: string }).text)
    .find((t) => /^(0\.5|1|2|5|10) m$/.test(t));
}

describe('branding header', () => {
  const LOGO = 'data:image/png;base64,AAAA';
  it('renders a larger logo image and puts the company caption to its left', () => {
    const sheet = buildFloorSheet(
      houseDoc(),
      opts({ brand: { logoDataUrl: LOGO, logoAspect: 3, companyName: 'L&D Energy' } }),
    );
    const img = sheet.shapes.find((s) => s.kind === 'image') as { w: number; h: number; x: number } | undefined;
    expect(img).toBeDefined();
    expect(img!.h).toBeGreaterThanOrEqual(11); // was 9mm — the "too tiny" logo
    const caption = sheet.shapes.find(
      (s) => s.kind === 'text' && (s as { text: string }).text === 'L&D Energy',
    ) as { x: number } | undefined;
    expect(caption).toBeDefined();
    // caption sits to the LEFT of the logo, not stacked beneath it on the rule
    expect(caption!.x).toBeLessThan(img!.x);
  });
});

describe('multi-floor header', () => {
  it('reports the whole-sheet total across floors when ≥2 heading stamps exist', () => {
    const doc = houseDoc();
    doc.labels = [
      { id: 'a', x: 1000, y: 7000, text: 'Ground Floor', heading: true },
      { id: 'b', x: 9000, y: 7000, text: 'First Floor', heading: true },
    ];
    const sheet = buildFloorSheet(doc, opts());
    const sub = sheet.shapes.find(
      (s) => s.kind === 'text' && /floors · Total GIA/.test((s as { text: string }).text),
    );
    expect(sub).toBeDefined();
  });

  it('keeps the single-floor subtitle when there are no heading stamps', () => {
    const sheet = buildFloorSheet(houseDoc(), opts());
    const sub = sheet.shapes.find(
      (s) => s.kind === 'text' && /^Ground Floor · Approx\. GIA/.test((s as { text: string }).text),
    );
    expect(sub).toBeDefined();
  });
});

describe('export scale bar', () => {
  it('renders a short 0.5 m bar on a typical plan, not an oversized 2 m one', () => {
    const sheet = buildFloorSheet(houseDoc(), opts());
    expect(scaleBarLabel(sheet.shapes)).toBe('0.5 m');
  });

  it('omits the scale bar when measurements are hidden', () => {
    const sheet = buildFloorSheet(houseDoc(), opts({ showMeasurements: false }));
    expect(scaleBarLabel(sheet.shapes)).toBeUndefined();
  });
});
