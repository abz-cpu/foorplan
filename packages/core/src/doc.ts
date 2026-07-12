import { newId } from './ids';
import { classifyExternalWalls } from './measure';
import type { SymbolInstance } from './symbols';
import {
  DEFAULT_WALL_THICKNESS_MM,
  EXTERNAL_WALL_THICKNESS_MM,
  type FloorDoc,
  type Opening,
  type Point,
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

/**
 * Uniformly scale the whole plan's drawn geometry by `factor` about
 * `origin` — the "calibrate to a known measurement" operation: sketch
 * roughly, then set one wall's true length and the entire plan snaps to
 * scale (Leica DISTO / zPlan style). Every planar length scales — wall
 * endpoints, room rects, opening offsets/widths, wall thickness, symbol
 * footprints, label positions. Ceiling heights and the north angle are NOT
 * spatial drawing data, so they're left untouched.
 */
export function scaleDoc(doc: FloorDoc, factor: number, origin: Point = { x: 0, y: 0 }): FloorDoc {
  if (!Number.isFinite(factor) || factor <= 0) return doc;
  const sp = (p: Point): Point => ({
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
  });
  return {
    ...doc,
    walls: doc.walls.map((w) => ({ ...w, a: sp(w.a), b: sp(w.b), thickness: w.thickness * factor })),
    rooms: doc.rooms.map((r) => ({
      ...r,
      x: origin.x + (r.x - origin.x) * factor,
      y: origin.y + (r.y - origin.y) * factor,
      w: r.w * factor,
      h: r.h * factor,
      labelOffset: r.labelOffset ? { x: r.labelOffset.x * factor, y: r.labelOffset.y * factor } : r.labelOffset,
    })),
    openings: doc.openings.map((o) => ({ ...o, offsetMm: o.offsetMm * factor, widthMm: o.widthMm * factor })),
    symbols: doc.symbols.map((s) => ({
      ...s,
      x: origin.x + (s.x - origin.x) * factor,
      y: origin.y + (s.y - origin.y) * factor,
      w: s.w * factor,
      h: s.h * factor,
    })),
    labels: doc.labels.map((l) => ({ ...l, x: origin.x + (l.x - origin.x) * factor, y: origin.y + (l.y - origin.y) * factor })),
  };
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

/** Set the ceiling height on every room at once — ceiling height is usually
 *  a whole-floor property, so it's captured once rather than per room. */
export function setFloorCeilingHeight(doc: FloorDoc, metres: number): FloorDoc {
  return { ...doc, rooms: doc.rooms.map((r) => ({ ...r, ceilingHeightM: metres })) };
}

/** The floor's representative ceiling height (the most common room value),
 *  or a default when there are no rooms yet. */
export function floorCeilingHeightM(doc: FloorDoc, fallback = 2.4): number {
  const rooms = doc.rooms.filter((r) => r.type !== 'Stairs');
  if (rooms.length === 0) return fallback;
  const counts = new Map<number, number>();
  for (const r of rooms) counts.set(r.ceilingHeightM, (counts.get(r.ceilingHeightM) ?? 0) + 1);
  let best = rooms[0].ceilingHeightM;
  let bestN = 0;
  for (const [h, n] of counts) if (n > bestN) [best, bestN] = [h, n];
  return best;
}

/** True when the rooms don't all share one ceiling height. */
export function floorHasMixedCeilings(doc: FloorDoc): boolean {
  const hs = new Set(doc.rooms.filter((r) => r.type !== 'Stairs').map((r) => r.ceilingHeightM));
  return hs.size > 1;
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

/**
 * Continuous variant of applyAutoWallThickness, safe to run after every
 * wall/room edit: only walls still at one of the two stock thicknesses are
 * reclassified, so a custom per-wall value (e.g. a typed 150mm) is never
 * stomped. With no rooms drawn yet classification has nothing to sample
 * against, so the doc is returned untouched rather than everything
 * collapsing to "internal".
 */
export function autoClassifyWallThickness(doc: FloorDoc): FloorDoc {
  if (doc.rooms.length === 0 || doc.walls.length === 0) return doc;
  const externalIds = classifyExternalWalls(doc);
  let changed = false;
  const walls = doc.walls.map((w) => {
    if (w.thickness !== DEFAULT_WALL_THICKNESS_MM && w.thickness !== EXTERNAL_WALL_THICKNESS_MM) return w;
    const want = externalIds.has(w.id) ? EXTERNAL_WALL_THICKNESS_MM : DEFAULT_WALL_THICKNESS_MM;
    if (w.thickness === want) return w;
    changed = true;
    return { ...w, thickness: want };
  });
  return changed ? { ...doc, walls } : doc;
}

/**
 * The walls a freshly drawn room needs so it's enclosed like a real room —
 * one per rectangle edge, skipping any edge an existing wall already runs
 * along (drawing a room against an existing wall must not double it up).
 *
 * Wall centrelines sit half a thickness OUTSIDE the room edge, matching the
 * convention everywhere else (rooms are inset from wall centrelines by half
 * the wall's thickness, so GIA excludes the wall body).
 */
export function wallsForRoom(
  doc: FloorDoc,
  room: RoomRect,
  thickness = DEFAULT_WALL_THICKNESS_MM,
): Wall[] {
  const half = thickness / 2;
  const x0 = room.x - half;
  const y0 = room.y - half;
  const x1 = room.x + room.w + half;
  const y1 = room.y + room.h + half;
  // Generous perpendicular band: catches a shared wall whether the new room
  // was snapped to the neighbouring room's edge, the wall's centreline, or
  // the wall's far face.
  const coverTol = 220;
  const edges: { a: Point; b: Point; horizontal: boolean }[] = [
    { a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, horizontal: true },
    { a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, horizontal: false },
    { a: { x: x1, y: y1 }, b: { x: x0, y: y1 }, horizontal: true },
    { a: { x: x0, y: y1 }, b: { x: x0, y: y0 }, horizontal: false },
  ];
  const out: Wall[] = [];
  for (const edge of edges) {
    const lo = Math.min(edge.horizontal ? edge.a.x : edge.a.y, edge.horizontal ? edge.b.x : edge.b.y);
    const hi = Math.max(edge.horizontal ? edge.a.x : edge.a.y, edge.horizontal ? edge.b.x : edge.b.y);
    const fixed = edge.horizontal ? edge.a.y : edge.a.x;
    const len = hi - lo;
    let covered = 0;
    for (const w of doc.walls) {
      const wallHorizontal = Math.abs(w.a.y - w.b.y) <= Math.abs(w.a.x - w.b.x);
      if (wallHorizontal !== edge.horizontal) continue;
      const wallFixed = edge.horizontal ? (w.a.y + w.b.y) / 2 : (w.a.x + w.b.x) / 2;
      if (Math.abs(wallFixed - fixed) > coverTol) continue;
      const wLo = Math.min(edge.horizontal ? w.a.x : w.a.y, edge.horizontal ? w.b.x : w.b.y);
      const wHi = Math.max(edge.horizontal ? w.a.x : w.a.y, edge.horizontal ? w.b.x : w.b.y);
      covered += Math.max(0, Math.min(hi, wHi) - Math.max(lo, wLo));
    }
    if (covered >= len * 0.6) continue;
    out.push({ id: newId(), a: edge.a, b: edge.b, thickness });
  }
  return out;
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

/**
 * A fresh floor doc containing only `source`'s exterior/perimeter walls
 * (via classifyExternalWalls), fresh ids, no rooms/openings/symbols/labels.
 * "Copy Perimeter to Next Floor": every storey shares the same building
 * envelope, so starting the next floor from that shell instead of a blank
 * canvas is real time saved without carrying over a lower floor's internal
 * layout, doors, or windows, which are rarely the same upstairs.
 */
export function copyPerimeterWalls(source: FloorDoc): FloorDoc {
  const externalIds = classifyExternalWalls(source);
  const walls = source.walls
    .filter((w) => externalIds.has(w.id))
    .map((w) => ({ ...w, id: newId() }));
  return { ...emptyFloorDoc(), walls };
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
