import type { SymbolInstance } from './symbols';
import type { Point, RoomRect, Wall } from './types';

function aabbOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): number {
  const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return ox * oy;
}

/**
 * A room's default label position (room-local offset from centre) when the
 * user hasn't dragged it. Nudges the name/area block off any furniture or
 * internal wall sitting mid-room, instead of stamping it dead-centre over a
 * bed or partition. Furniture footprints and thin wall strips become
 * obstacle boxes; the label box is scored against them at a few vertical
 * positions and the clearest one nearest the centre wins.
 *
 * Shared by the editor canvas and the exported sheet so a label sits in the
 * same place in both — the export used to ignore this and stamp the centre.
 */
export function smartRoomLabelOffset(room: RoomRect, symbols: SymbolInstance[], walls: Wall[]): Point {
  const halfW = Math.min(room.w * 0.45, 1600);
  const halfH = 420;
  const obstacles: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const s of symbols) {
    if (s.x + s.w < room.x || s.x > room.x + room.w || s.y + s.h < room.y || s.y > room.y + room.h) continue;
    obstacles.push({ x0: s.x - room.x, y0: s.y - room.y, x1: s.x + s.w - room.x, y1: s.y + s.h - room.y });
  }
  for (const w of walls) {
    const t = w.thickness / 2 + 60;
    obstacles.push({
      x0: Math.min(w.a.x, w.b.x) - t - room.x,
      y0: Math.min(w.a.y, w.b.y) - t - room.y,
      x1: Math.max(w.a.x, w.b.x) + t - room.x,
      y1: Math.max(w.a.y, w.b.y) + t - room.y,
    });
  }
  if (obstacles.length === 0) return { x: 0, y: 0 };
  const cx = room.w / 2;
  const candidates = [room.h / 2, room.h * 0.74, room.h * 0.26, room.h * 0.86, room.h * 0.14];
  let best = { x: 0, y: 0 };
  let bestScore = Infinity;
  for (const cy of candidates) {
    const box = { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
    let score = Math.abs(cy - room.h / 2) * 0.02; // tie-break toward centre
    for (const o of obstacles) score += aabbOverlap(box, o);
    if (score < bestScore) {
      bestScore = score;
      best = { x: 0, y: cy - room.h / 2 };
    }
  }
  return best;
}

/**
 * The label offset actually used for a room: an explicit dragged position if
 * the user set one, otherwise the smart auto-placement (which dodges
 * furniture/partitions). Stairs carry no label, so they get zero.
 */
export function resolveRoomLabelOffset(room: RoomRect, symbols: SymbolInstance[], walls: Wall[]): Point {
  if (room.labelOffset) return room.labelOffset;
  if (room.type === 'Stairs') return { x: 0, y: 0 };
  return smartRoomLabelOffset(room, symbols, walls);
}
