import {
  DEFAULT_CEILING_HEIGHT_M,
  DEFAULT_WALL_THICKNESS_MM,
  type FloorDoc,
  type Point,
  type RoomRect,
  type Wall,
} from './types';
import { detectWallFaces, insetPolygonVariable, pointInPolygon, ringBounds } from './faces';
import { polygonAreaMm2, roomPolygon } from './geometry';
import { newId } from './ids';

/**
 * Detect enclosed rooms from the wall layout using planar face detection
 * (see faces.ts): every closed loop of walls becomes one room, following
 * angled/bay walls and rectilinear L/T/U shapes exactly. A rectangular loop
 * is stored as a plain x/y/w/h rect; any other shape carries its outline in
 * `polygon`. Existing rooms suppress a re-detection of the area they occupy.
 */

/** True when a 4-vertex ring is an axis-aligned rectangle. */
function isAxisAlignedRect(ring: Point[]): boolean {
  if (ring.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > 2 && Math.abs(a.y - b.y) > 2) return false; // diagonal edge
  }
  return true;
}

/** Perpendicular distance from p to segment a→b. */
function pointToSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Centroid (vertex average) of a ring. */
function centroid(ring: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/**
 * For each face edge, the inward inset that lands the room on the bounding
 * wall's inner face: half the thickness of the wall the edge runs along
 * (faces are traced along wall centrelines), or a partition default if none
 * is matched.
 */
function edgeInsets(face: Point[], walls: Wall[]): number[] {
  return face.map((a, i) => {
    const b = face[(i + 1) % face.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let half = DEFAULT_WALL_THICKNESS_MM / 2;
    let best = 80; // must lie essentially on the wall centreline
    for (const w of walls) {
      const d = pointToSegDist(mid, w.a, w.b);
      if (d < best) {
        best = d;
        half = w.thickness / 2;
      }
    }
    return half;
  });
}

export function detectRooms(doc: FloorDoc): RoomRect[] {
  const faces = detectWallFaces(doc.walls);
  const rooms: RoomRect[] = [];

  for (const face of faces) {
    if (polygonAreaMm2(face) < 600 * 600) continue; // implausibly small

    // Skip when this face is already occupied by an existing (non-stairs)
    // room — checked both ways so an L-shaped room, whose bbox centre can
    // fall outside its own outline, still suppresses its own face. Stairs
    // are a visual asset sitting inside a room, not a room.
    const faceMid = centroid(face);
    const taken = doc.rooms.some((room) => {
      if (room.type === 'Stairs') return false;
      const poly = roomPolygon(room);
      return pointInPolygon(centroid(poly), face) || pointInPolygon(faceMid, poly);
    });
    if (taken) continue;

    const polygon = insetPolygonVariable(face, edgeInsets(face, doc.walls));
    const b = ringBounds(polygon);
    if (b.w < 500 || b.h < 500) continue;

    const rect = isAxisAlignedRect(polygon);
    rooms.push({
      id: newId(),
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      ...(rect ? {} : { polygon }),
      name: `Room ${doc.rooms.length + rooms.length + 1}`,
      type: 'Other',
      ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
      includeInGia: true,
    });
  }
  return rooms;
}
