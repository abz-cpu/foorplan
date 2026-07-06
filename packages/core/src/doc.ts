import type { FloorDoc, RoomRect, TextLabel, Wall } from './types';

export function emptyFloorDoc(): FloorDoc {
  return { schemaVersion: 1, walls: [], rooms: [], labels: [] };
}

export function serializeDoc(doc: FloorDoc): string {
  return JSON.stringify(doc);
}

export function parseDoc(json: string): FloorDoc {
  const raw = JSON.parse(json) as Partial<FloorDoc>;
  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported floor document schema: ${String(raw.schemaVersion)}`);
  }
  return {
    schemaVersion: 1,
    walls: raw.walls ?? [],
    rooms: raw.rooms ?? [],
    labels: raw.labels ?? [],
  };
}

/* Immutable update helpers — every mutation returns a new doc. */

export function addWall(doc: FloorDoc, wall: Wall): FloorDoc {
  return { ...doc, walls: [...doc.walls, wall] };
}

export function addRoom(doc: FloorDoc, room: RoomRect): FloorDoc {
  return { ...doc, rooms: [...doc.rooms, room] };
}

export function addLabel(doc: FloorDoc, label: TextLabel): FloorDoc {
  return { ...doc, labels: [...doc.labels, label] };
}

export function updateRoom(doc: FloorDoc, id: string, patch: Partial<Omit<RoomRect, 'id'>>): FloorDoc {
  return {
    ...doc,
    rooms: doc.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
}

export function updateWall(doc: FloorDoc, id: string, patch: Partial<Omit<Wall, 'id'>>): FloorDoc {
  return {
    ...doc,
    walls: doc.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  };
}

/** Remove any entity (wall, room, or label) by id. */
export function deleteEntity(doc: FloorDoc, id: string): FloorDoc {
  return {
    ...doc,
    walls: doc.walls.filter((w) => w.id !== id),
    rooms: doc.rooms.filter((r) => r.id !== id),
    labels: doc.labels.filter((l) => l.id !== id),
  };
}

export function findRoom(doc: FloorDoc, id: string): RoomRect | undefined {
  return doc.rooms.find((r) => r.id === id);
}

export function findWall(doc: FloorDoc, id: string): Wall | undefined {
  return doc.walls.find((w) => w.id === id);
}

/** All wall endpoints — snap candidates for the wall tool. */
export function wallEndpoints(doc: FloorDoc): { x: number; y: number }[] {
  return doc.walls.flatMap((w) => [w.a, w.b]);
}
