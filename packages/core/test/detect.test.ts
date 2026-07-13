import { describe, expect, it } from 'vitest';
import { detectRooms } from '../src/detect';
import { pointInPolygon } from '../src/faces';
import { suggestRoomNames, generateDescription } from '../src/assistant';
import { addRoom, addWall, emptyFloorDoc } from '../src/doc';
import type { FloorDoc, RoomRect, Wall } from '../src/types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  thickness: 100,
});

/** 8m x 6m rectangle of walls with a full-height divider at x=5000. */
function dividedRect(): FloorDoc {
  let doc = emptyFloorDoc();
  doc = addWall(doc, wall('t', 0, 0, 8000, 0));
  doc = addWall(doc, wall('r', 8000, 0, 8000, 6000));
  doc = addWall(doc, wall('b', 0, 6000, 8000, 6000));
  doc = addWall(doc, wall('l', 0, 0, 0, 6000));
  doc = addWall(doc, wall('div', 5000, 0, 5000, 6000));
  return doc;
}

describe('detectRooms', () => {
  it('detects the two enclosed cells of a divided rectangle', () => {
    const rooms = detectRooms(dividedRect());
    expect(rooms).toHaveLength(2);
    const areas = rooms.map((r) => Math.round((r.w * r.h) / 1e4)).sort((a, b) => a - b);
    // 5m x 6m and 3m x 6m minus the 50mm inset
    expect(rooms[0].includeInGia).toBe(true);
    expect(areas[0]).toBeLessThan(areas[1]);
  });

  it('detects a single room for a plain enclosure', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall('t', 0, 0, 4000, 0));
    doc = addWall(doc, wall('r', 4000, 0, 4000, 3000));
    doc = addWall(doc, wall('b', 0, 3000, 4000, 3000));
    doc = addWall(doc, wall('l', 0, 0, 0, 3000));
    const rooms = detectRooms(doc);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].w).toBe(3900);
    expect(rooms[0].h).toBe(2900);
  });

  it('detects nothing for unclosed walls', () => {
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall('t', 0, 0, 4000, 0));
    doc = addWall(doc, wall('l', 0, 0, 0, 3000));
    expect(detectRooms(doc)).toHaveLength(0);
  });

  it('detects an L-shaped enclosure as a single polygon room', () => {
    // Full left column (0-5000 wide, full 0-6000 height) plus a bottom-right
    // band (5000-8000 wide, 3000-6000 height) — the top-right 3000x3000
    // corner is left open, carving an L out of the overall 8000x6000 box.
    let doc = emptyFloorDoc();
    doc = addWall(doc, wall('t1', 0, 0, 5000, 0));
    doc = addWall(doc, wall('notch-v', 5000, 0, 5000, 3000));
    doc = addWall(doc, wall('notch-h', 5000, 3000, 8000, 3000));
    doc = addWall(doc, wall('r', 8000, 3000, 8000, 6000));
    doc = addWall(doc, wall('b', 8000, 6000, 0, 6000));
    doc = addWall(doc, wall('l', 0, 6000, 0, 0));

    const rooms = detectRooms(doc);
    expect(rooms).toHaveLength(1); // one room, one polygon — not decomposed
    expect(rooms[0].polygon).toBeDefined();
    expect(rooms[0].polygon!.length).toBe(6); // an L has six corners
    expect(rooms[0].type).toBe('Other');

    // The open top-right notch must never be inside the detected room.
    expect(pointInPolygon({ x: 6500, y: 1500 }, rooms[0].polygon!)).toBe(false);
  });

  it('skips cells already containing a room', () => {
    const room: RoomRect = {
      id: 'r1',
      x: 100,
      y: 100,
      w: 4800,
      h: 5800,
      name: 'Living Room',
      type: 'Living Room',
      ceilingHeightM: 2.4,
      includeInGia: true,
    };
    const rooms = detectRooms(addRoom(dividedRect(), room));
    expect(rooms).toHaveLength(1); // only the right cell remains
    expect(rooms[0].x).toBeGreaterThan(4900);
  });
});

describe('assistant heuristics', () => {
  const room = (id: string, w: number, h: number): RoomRect => ({
    id,
    x: 0,
    y: 0,
    w,
    h,
    name: id,
    type: 'Other',
    ceilingHeightM: 2.4,
    includeInGia: true,
  });

  it('names rooms by size ordering on the ground floor', () => {
    const doc: FloorDoc = {
      ...emptyFloorDoc(),
      rooms: [room('big', 5000, 4000), room('mid', 4000, 3000), room('tiny', 1200, 1500)],
    };
    const suggestions = suggestRoomNames(doc, 0);
    const byId = Object.fromEntries(suggestions.map((s) => [s.roomId, s]));
    expect(byId.big.name).toBe('Living Room');
    expect(byId.mid.name).toBe('Kitchen/Diner');
    expect(byId.tiny.type).toBe('WC');
  });

  it('generates a description mentioning address, GIA, and rooms', () => {
    const doc: FloorDoc = { ...emptyFloorDoc(), rooms: [room('a', 4000, 3000)] };
    doc.rooms[0].name = 'Living Room';
    const text = generateDescription({
      address: '14 Wolseley Road',
      floors: [{ name: 'Ground Floor', doc }],
    });
    expect(text).toContain('14 Wolseley Road');
    expect(text).toContain('12.0 m²');
    expect(text).toContain('living room');
  });
});
