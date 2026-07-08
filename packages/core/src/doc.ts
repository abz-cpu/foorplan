import { classifyExternalWalls } from './measure';
import type { SymbolInstance } from './symbols';
import {
  DEFAULT_WALL_THICKNESS_MM,
  EXTERNAL_WALL_THICKNESS_MM,
  type FloorDoc,
  type Opening,
  type RoomRect,
  type TextLabel,
  type Underlay,
  type Wall,
} from './types';

export function emptyFloorDoc(): FloorDoc {
  return { schemaVersion: 1, walls: [], rooms: [], labels: [], openings: [], symbols: [] };
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
    // additive fields — docs saved before they existed parse fine
    openings: raw.openings ?? [],
    symbols: raw.symbols ?? [],
    ...(raw.underlay ? { underlay: raw.underlay } : {}),
  };
}

/** Normalise docs loaded from storage that predate newer additive fields. */
export function normalizeDoc(doc: FloorDoc): FloorDoc {
  if (doc.openings && doc.symbols) return doc;
  return { ...doc, openings: doc.openings ?? [], symbols: doc.symbols ?? [] };
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

/**
 * One-shot bulk classification: sets every wall on the exposed (heat-loss)
 * boundary to the external thickness and every other wall to the internal
 * default. A deliberate, undoable user action rather than continuous
 * background reclassification, so it never fights a manual per-wall
 * thickness edit made afterwards.
 */
export function applyAutoWallThickness(doc: FloorDoc): FloorDoc {
  const externalIds = classifyExternalWalls(doc);
  return {
    ...doc,
    walls: doc.walls.map((w) => ({
      ...w,
      thickness: externalIds.has(w.id) ? EXTERNAL_WALL_THICKNESS_MM : DEFAULT_WALL_THICKNESS_MM,
    })),
  };
}

export function addOpening(doc: FloorDoc, opening: Opening): FloorDoc {
  return { ...doc, openings: [...doc.openings, opening] };
}

export function updateOpening(
  doc: FloorDoc,
  id: string,
  patch: Partial<Omit<Opening, 'id' | 'wallId'>>,
): FloorDoc {
  return {
    ...doc,
    openings: doc.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  };
}

export function addSymbol(doc: FloorDoc, symbol: SymbolInstance): FloorDoc {
  return { ...doc, symbols: [...doc.symbols, symbol] };
}

export function updateSymbol(
  doc: FloorDoc,
  id: string,
  patch: Partial<Omit<SymbolInstance, 'id' | 'kind'>>,
): FloorDoc {
  return { ...doc, symbols: doc.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function updateLabel(
  doc: FloorDoc,
  id: string,
  patch: Partial<Omit<TextLabel, 'id'>>,
): FloorDoc {
  return { ...doc, labels: doc.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

export function setUnderlay(doc: FloorDoc, underlay: Underlay | null): FloorDoc {
  return { ...doc, underlay };
}

/** Degrees clockwise from up, wrapped into [0, 360). */
export function setNorthAngle(doc: FloorDoc, deg: number): FloorDoc {
  const wrapped = ((deg % 360) + 360) % 360;
  return { ...doc, northAngleDeg: wrapped };
}

/** Remove any entity by id. Deleting a wall also removes its openings. */
export function deleteEntity(doc: FloorDoc, id: string): FloorDoc {
  return deleteEntities(doc, [id]);
}

/** Remove any number of entities (rooms, walls, openings, symbols, labels)
 *  by id in one step — one undo entry instead of one per item. Deleting a
 *  wall also removes its openings. */
export function deleteEntities(doc: FloorDoc, ids: string[]): FloorDoc {
  const idSet = new Set(ids);
  if (idSet.size === 0) return doc;
  return {
    ...doc,
    walls: doc.walls.filter((w) => !idSet.has(w.id)),
    rooms: doc.rooms.filter((r) => !idSet.has(r.id)),
    labels: doc.labels.filter((l) => !idSet.has(l.id)),
    openings: doc.openings.filter((o) => !idSet.has(o.id) && !idSet.has(o.wallId)),
    symbols: doc.symbols.filter((s) => !idSet.has(s.id)),
  };
}

export function findRoom(doc: FloorDoc, id: string): RoomRect | undefined {
  return doc.rooms.find((r) => r.id === id);
}

export function findWall(doc: FloorDoc, id: string): Wall | undefined {
  return doc.walls.find((w) => w.id === id);
}

export function findOpening(doc: FloorDoc, id: string): Opening | undefined {
  return doc.openings.find((o) => o.id === id);
}

/** All wall endpoints — snap candidates for the wall tool. */
export function wallEndpoints(doc: FloorDoc): { x: number; y: number }[] {
  return doc.walls.flatMap((w) => [w.a, w.b]);
}
