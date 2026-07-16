import { describe, expect, it } from 'vitest';
import { addRoom, emptyFloorDoc } from '../src/doc';
import {
  deriveEdge,
  docToShapes,
  headingFloorStats,
  openingShapes,
  type Shape,
} from '../src/shapes';
import { doorSwingGeometry } from '../src/openings';
import type { Opening, RoomRect, TextLabel, Wall } from '../src/types';

const texts = (shapes: Shape[]) =>
  shapes.filter((s): s is Extract<Shape, { kind: 'text' }> => s.kind === 'text').map((s) => s.text);

const room = (over: Partial<RoomRect> = {}): RoomRect => ({
  id: 'r', x: 0, y: 0, w: 4000, h: 3000, name: 'Lounge', type: 'Lounge',
  ceilingHeightM: 2.4, includeInGia: true, ...over,
});

describe('deriveEdge', () => {
  it('darkens a fill toward an outline tone', () => {
    expect(deriveEdge('#E4EEE8')).toMatch(/^#[0-9a-f]{6}$/i);
    // pure white darkens to a mid-grey, not white
    const e = deriveEdge('#FFFFFF', 0.28);
    expect(e.toLowerCase()).not.toBe('#ffffff');
  });
  it('falls back for a bad hex', () => {
    expect(deriveEdge('nope')).toBe('#D8E1DD');
  });
});

describe('per-room custom colour', () => {
  it('fills a room with its custom colour in presentation mode', () => {
    const doc = { ...emptyFloorDoc(), rooms: [room({ color: '#123456' })] };
    const shapes = docToShapes(doc, { showLabels: false, planMode: 'presentation' });
    const fillShape = shapes.find(
      (s) => (s.kind === 'rect' || s.kind === 'polyline') && (s as { fill?: string }).fill === '#123456',
    );
    expect(fillShape).toBeDefined();
  });
  it('ignores custom colour in technical mode (line-art stays white)', () => {
    const doc = { ...emptyFloorDoc(), rooms: [room({ color: '#123456' })] };
    const shapes = docToShapes(doc, { showLabels: false, planMode: 'technical' });
    expect(shapes.some((s) => (s as { fill?: string }).fill === '#123456')).toBe(false);
  });
});

describe('label-only rooms (hideAreaLabel)', () => {
  it('shows just the name — no area or dims lines', () => {
    const doc = { ...emptyFloorDoc(), rooms: [room({ name: 'Hallway', hideAreaLabel: true })] };
    const t = texts(docToShapes(doc, { showLabels: true, planMode: 'technical' }));
    expect(t).toContain('Hallway');
    expect(t.some((x) => /m²/.test(x))).toBe(false);
    expect(t.some((x) => /×/.test(x))).toBe(false);
  });
  it('still shows area + dims when the flag is off', () => {
    const doc = { ...emptyFloorDoc(), rooms: [room({ name: 'Kitchen' })] };
    const t = texts(docToShapes(doc, { showLabels: true, planMode: 'technical' }));
    expect(t.some((x) => /m²/.test(x))).toBe(true);
    expect(t.some((x) => /×/.test(x))).toBe(true);
  });
});

describe('door swing depth', () => {
  const wall: Wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };
  const door: Opening = { id: 'd', wallId: 'w', kind: 'door', offsetMm: 2000, widthMm: 900, hinge: 'left' };

  it('defaults the swing radius to the opening width', () => {
    expect(doorSwingGeometry(wall, door).radius).toBe(900);
  });
  it('a shallower swingDepth reduces the arc radius, keeping the opening width', () => {
    const g = doorSwingGeometry(wall, { ...door, swingDepthMm: 500 });
    expect(g.radius).toBe(500);
    const arc = openingShapes(wall, { ...door, swingDepthMm: 500 }, {}).find((s) => s.kind === 'arc');
    expect(arc && arc.kind === 'arc' && arc.r).toBe(500);
  });
  it('clamps a too-deep swing back to the opening width', () => {
    expect(doorSwingGeometry(wall, { ...door, swingDepthMm: 5000 }).radius).toBe(900);
  });
});

describe('per-floor heading stamps', () => {
  // Two detached storeys side by side, each titled, with different rooms.
  const ground: RoomRect = { id: 'g1', x: 0, y: 0, w: 4000, h: 3000, name: 'Living', type: 'Living Room', ceilingHeightM: 2.4, includeInGia: true };
  const first: RoomRect = { id: 'f1', x: 12000, y: 0, w: 3000, h: 3000, name: 'Bed', type: 'Bedroom', ceilingHeightM: 2.7, includeInGia: true };
  const lGround: TextLabel = { id: 'lg', x: 2000, y: 4000, text: 'Ground Floor', heading: true };
  const lFirst: TextLabel = { id: 'lf', x: 13500, y: 4000, text: 'First Floor', heading: true };
  const doc = { ...emptyFloorDoc(), rooms: [ground, first], labels: [lGround, lFirst] };

  it('each stamp totals only the rooms nearest its own title', () => {
    const g = headingFloorStats(doc, lGround);
    const f = headingFloorStats(doc, lFirst);
    expect(g.areaM2).toBeCloseTo(12, 1); // 4×3
    expect(f.areaM2).toBeCloseTo(9, 1); // 3×3
  });
  it('derives each floor its own ceiling height', () => {
    expect(headingFloorStats(doc, lGround).ceilingM).toBeCloseTo(2.4, 2);
    expect(headingFloorStats(doc, lFirst).ceilingM).toBeCloseTo(2.7, 2);
  });
  it('a manual height override wins', () => {
    expect(headingFloorStats(doc, { ...lFirst, heightM: 2.1 }).ceilingM).toBe(2.1);
  });
  it('renders a GIA + ceiling stat line under a heading', () => {
    const t = texts(docToShapes(doc, { showLabels: true, showDims: false }));
    expect(t).toContain('Ground Floor');
    expect(t.some((x) => /GIA .* · .* m ceiling/.test(x))).toBe(true);
  });
  it('a bare title (floorStamp false) shows no stat line', () => {
    const bare = { ...doc, labels: [{ ...lGround, floorStamp: false }] };
    const t = texts(docToShapes(bare, { showLabels: true, showDims: false }));
    expect(t).toContain('Ground Floor');
    expect(t.some((x) => /GIA/.test(x))).toBe(false);
  });
});

describe('single-floor stamp still totals the whole plan', () => {
  it('with one heading, all rooms count toward it', () => {
    let doc = emptyFloorDoc();
    doc = addRoom(doc, room({ id: 'a', x: 0, y: 0, w: 4000, h: 3000 }));
    doc = addRoom(doc, room({ id: 'b', x: 5000, y: 0, w: 2000, h: 3000, name: 'Kitchen' }));
    const label: TextLabel = { id: 'l', x: 2500, y: 4000, text: 'Ground Floor', heading: true };
    doc = { ...doc, labels: [label] };
    expect(headingFloorStats(doc, label).areaM2).toBeCloseTo(18, 1); // 12 + 6
  });
});
