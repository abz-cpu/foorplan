import { addOpening, addWall, applyAutoWallThickness, emptyFloorDoc, updateRoom } from './doc';
import { detectRooms } from './detect';
import { newId } from './ids';
import type { FloorDoc, RoomType, Wall } from './types';

/**
 * Starter plan templates — realistic UK property layouts built from the same
 * primitives a user draws with, so everything stays fully editable. Each
 * template creates a property's complete set of floors; the user just types
 * the address and adjusts dimensions to match the survey.
 */

export interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  /** e.g. "1 bed · 1 floor · ≈32 m²" */
  summary: string;
  buildFloors(): { name: string; doc: FloorDoc }[];
}

const wall = (x1: number, y1: number, x2: number, y2: number): Wall => ({
  id: newId(),
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  thickness: 100,
});

/** Detect rooms from the walls, then rename them left-to-right/top-to-bottom
 *  with the given name/type pairs (sorted by centre: y first, then x). */
function detectAndName(doc: FloorDoc, names: { name: string; type: RoomType }[]): FloorDoc {
  let next = { ...doc, rooms: detectRooms(doc) };
  const ordered = [...next.rooms].sort((a, b) => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    if (Math.abs(ay - by) > 800) return ay - by;
    return a.x + a.w / 2 - (b.x + b.w / 2);
  });
  ordered.forEach((room, i) => {
    const n = names[i];
    if (n) next = updateRoom(next, room.id, { name: n.name, type: n.type });
  });
  return applyAutoWallThickness(next);
}

function frontDoor(doc: FloorDoc, y: number, offsetMm: number): FloorDoc {
  const front = doc.walls.find((w) => w.a.y === y && w.b.y === y);
  if (!front) return doc;
  return addOpening(doc, {
    id: newId(),
    wallId: front.id,
    kind: 'door',
    offsetMm,
    widthMm: 900,
    hinge: 'left',
  });
}

/* ---------------------------------- Studio flat ---------------------------------- */

function studioFlat(): { name: string; doc: FloorDoc }[] {
  let doc = emptyFloorDoc();
  // 7.0m x 5.0m envelope, bathroom boxed into the top-right corner.
  doc = addWall(doc, wall(0, 0, 7000, 0));
  doc = addWall(doc, wall(7000, 0, 7000, 5000));
  doc = addWall(doc, wall(7000, 5000, 0, 5000));
  doc = addWall(doc, wall(0, 5000, 0, 0));
  doc = addWall(doc, wall(4800, 0, 4800, 2200));
  doc = addWall(doc, wall(4800, 2200, 7000, 2200));
  doc = detectAndName(doc, [
    { name: 'Bathroom', type: 'Bathroom' },
    { name: 'Studio Room', type: 'Living Room' },
  ]);
  doc = frontDoor(doc, 5000, 1000);
  return [{ name: 'Ground Floor', doc }];
}

/* --------------------------------- 2-bed terrace --------------------------------- */

function twoBedTerrace(): { name: string; doc: FloorDoc }[] {
  // Ground: living room front, kitchen/diner rear, in a 4.8m x 8.6m envelope.
  let ground = emptyFloorDoc();
  ground = addWall(ground, wall(0, 0, 4800, 0));
  ground = addWall(ground, wall(4800, 0, 4800, 8600));
  ground = addWall(ground, wall(4800, 8600, 0, 8600));
  ground = addWall(ground, wall(0, 8600, 0, 0));
  ground = addWall(ground, wall(0, 4200, 4800, 4200));
  ground = detectAndName(ground, [
    { name: 'Kitchen/Diner', type: 'Kitchen / Diner' },
    { name: 'Living Room', type: 'Living Room' },
  ]);
  ground = frontDoor(ground, 8600, 900);

  // First: two bedrooms front/rear, bathroom boxed off the rear bedroom.
  let first = emptyFloorDoc();
  first = addWall(first, wall(0, 0, 4800, 0));
  first = addWall(first, wall(4800, 0, 4800, 8600));
  first = addWall(first, wall(4800, 8600, 0, 8600));
  first = addWall(first, wall(0, 8600, 0, 0));
  first = addWall(first, wall(0, 3400, 4800, 3400));
  first = addWall(first, wall(2600, 0, 2600, 3400));
  first = detectAndName(first, [
    { name: 'Bathroom', type: 'Bathroom' },
    { name: 'Bedroom 2', type: 'Bedroom' },
    { name: 'Bedroom 1', type: 'Bedroom' },
  ]);
  return [
    { name: 'Ground Floor', doc: ground },
    { name: 'First Floor', doc: first },
  ];
}

/* ---------------------------------- 3-bed semi ---------------------------------- */

function threeBedSemi(): { name: string; doc: FloorDoc }[] {
  // Ground: hallway + WC on the right strip, living front-left,
  // kitchen/diner rear spanning the full width below the partition.
  let ground = emptyFloorDoc();
  ground = addWall(ground, wall(0, 0, 7600, 0));
  ground = addWall(ground, wall(7600, 0, 7600, 8400));
  ground = addWall(ground, wall(7600, 8400, 0, 8400));
  ground = addWall(ground, wall(0, 8400, 0, 0));
  ground = addWall(ground, wall(0, 4600, 7600, 4600));
  ground = addWall(ground, wall(5200, 0, 5200, 4600));
  ground = addWall(ground, wall(5200, 1800, 7600, 1800));
  ground = detectAndName(ground, [
    { name: 'WC', type: 'WC' },
    { name: 'Living Room', type: 'Living Room' },
    { name: 'Hallway', type: 'Hallway' },
    { name: 'Kitchen/Diner', type: 'Kitchen / Diner' },
  ]);
  ground = frontDoor(ground, 8400, 6000);

  // First: bed 1 front-left, bed 2 rear-left, bed 3 + bathroom on the right.
  let first = emptyFloorDoc();
  first = addWall(first, wall(0, 0, 7600, 0));
  first = addWall(first, wall(7600, 0, 7600, 8400));
  first = addWall(first, wall(7600, 8400, 0, 8400));
  first = addWall(first, wall(0, 8400, 0, 0));
  first = addWall(first, wall(0, 4200, 7600, 4200));
  first = addWall(first, wall(4600, 0, 4600, 4200));
  first = addWall(first, wall(4600, 4200, 4600, 8400));
  first = detectAndName(first, [
    { name: 'Bedroom 2', type: 'Bedroom' },
    { name: 'Bathroom', type: 'Bathroom' },
    { name: 'Bedroom 1', type: 'Bedroom' },
    { name: 'Bedroom 3', type: 'Bedroom' },
  ]);
  return [
    { name: 'Ground Floor', doc: ground },
    { name: 'First Floor', doc: first },
  ];
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'studio-flat',
    name: 'Studio flat',
    description: 'Open studio with a boxed-off bathroom — a fast starting point for small lets.',
    summary: 'Studio · 1 floor · ≈33 m²',
    buildFloors: studioFlat,
  },
  {
    id: 'two-bed-terrace',
    name: '2-bed terrace',
    description: 'Classic through-terrace: living room and kitchen/diner below, two bedrooms and bathroom above.',
    summary: '2 bed · 2 floors · ≈78 m²',
    buildFloors: twoBedTerrace,
  },
  {
    id: 'three-bed-semi',
    name: '3-bed semi',
    description: 'Hallway, WC, living room and kitchen/diner downstairs; three bedrooms and a family bathroom up.',
    summary: '3 bed · 2 floors · ≈122 m²',
    buildFloors: threeBedSemi,
  },
];
