import { DEFAULT_CEILING_HEIGHT_M, type FloorDoc, type Point, type RoomRect } from './types';
import { detectWallFaces, insetPolygon, pointInPolygon, ringBounds } from './faces';
import { polygonAreaMm2 } from './geometry';
import { newId } from './ids';

/**
 * Detect enclosed rooms from the wall layout using planar face detection
 * (see faces.ts): every closed loop of walls becomes one room, following
 * angled/bay walls and rectilinear L/T/U shapes exactly. A rectangular loop
 * is stored as a plain x/y/w/h rect; any other shape carries its outline in
 * `polygon`. Existing rooms suppress a re-detection of the area they occupy.
 */

const INSET_MM = 50; // half a typical wall thickness, so the room sits inside the walls

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

export function detectRooms(doc: FloorDoc): RoomRect[] {
  const faces = detectWallFaces(doc.walls);
  const rooms: RoomRect[] = [];

  for (const face of faces) {
    if (polygonAreaMm2(face) < 600 * 600) continue; // implausibly small

    // Skip when an existing (non-stairs) room's centre already lies inside
    // this face — stairs are a visual asset sitting inside a room, not a room.
    const taken = doc.rooms.some((room) => {
      if (room.type === 'Stairs') return false;
      return pointInPolygon({ x: room.x + room.w / 2, y: room.y + room.h / 2 }, face);
    });
    if (taken) continue;

    const polygon = insetPolygon(face, INSET_MM);
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
