import {
  addOpening,
  addSymbol,
  addWall,
  applyAutoWallThickness,
  emptyFloorDoc,
  updateRoom,
} from './doc';
import { detectRooms } from './detect';
import { newId } from './ids';
import type { FloorDoc } from './types';

/**
 * A small, realistic sample flat — an outer perimeter, one internal
 * partition, a front door, a window, and a couple of furniture pieces —
 * built from the same primitives a real user draws with. Gives a first-time
 * user a real plan to explore (rooms, GIA, export) instead of a blank canvas.
 */
export function buildDemoFloorDoc(): FloorDoc {
  let doc = emptyFloorDoc();
  doc = addWall(doc, { id: newId(), a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 100 });
  doc = addWall(doc, { id: newId(), a: { x: 6000, y: 0 }, b: { x: 6000, y: 5000 }, thickness: 100 });
  doc = addWall(doc, { id: newId(), a: { x: 6000, y: 5000 }, b: { x: 0, y: 5000 }, thickness: 100 });
  doc = addWall(doc, { id: newId(), a: { x: 0, y: 5000 }, b: { x: 0, y: 0 }, thickness: 100 });
  doc = addWall(doc, { id: newId(), a: { x: 3000, y: 0 }, b: { x: 3000, y: 5000 }, thickness: 100 });

  const rooms = detectRooms(doc);
  doc = { ...doc, rooms };
  const [livingRoom, bedroom] = [...doc.rooms].sort((a, b) => a.x - b.x);
  if (livingRoom) doc = updateRoom(doc, livingRoom.id, { name: 'Living Room', type: 'Living Room' });
  if (bedroom) doc = updateRoom(doc, bedroom.id, { name: 'Bedroom', type: 'Bedroom' });

  // classifyExternalWalls (inside applyAutoWallThickness) samples against
  // doc.rooms, so it must run after rooms are detected and populated above.
  doc = applyAutoWallThickness(doc);

  const frontWall = doc.walls.find((w) => w.a.y === 5000 && w.b.y === 5000);
  if (frontWall) {
    doc = addOpening(doc, {
      id: newId(),
      wallId: frontWall.id,
      kind: 'door',
      offsetMm: 1200,
      widthMm: 900,
      hinge: 'left',
    });
  }
  const bedroomOuterWall = doc.walls.find((w) => w.a.x === 6000 && w.b.x === 6000);
  if (bedroomOuterWall) {
    doc = addOpening(doc, {
      id: newId(),
      wallId: bedroomOuterWall.id,
      kind: 'window',
      offsetMm: 2500,
      widthMm: 1200,
      hinge: 'left',
    });
  }

  doc = addSymbol(doc, { id: newId(), kind: 'sofa', x: 450, y: 3900, w: 2000, h: 900, rotationDeg: 0 });
  doc = addSymbol(doc, { id: newId(), kind: 'bed-double', x: 3950, y: 300, w: 1500, h: 2000, rotationDeg: 0 });

  return doc;
}
