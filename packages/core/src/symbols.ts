/**
 * Furniture/fixture symbol library. Each symbol is a list of drawing
 * primitives in a 0–100 unit box, scaled to the instance's real-world size.
 * Primitives map 1:1 onto the display-list shapes every backend supports.
 */

export type SymbolPrimitive =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'circle'; cx: number; cy: number; r: number };

export interface SymbolDef {
  name: string;
  /** default footprint in mm */
  w: number;
  h: number;
  prims: SymbolPrimitive[];
}

export const SYMBOL_DEFS = {
  'bed-double': {
    name: 'Double bed',
    w: 1500,
    h: 2000,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'rect', x: 8, y: 5, w: 38, h: 16 },
      { t: 'rect', x: 54, y: 5, w: 38, h: 16 },
      { t: 'line', x1: 0, y1: 28, x2: 100, y2: 28 },
    ],
  },
  'bed-single': {
    name: 'Single bed',
    w: 900,
    h: 2000,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'rect', x: 15, y: 5, w: 70, h: 16 },
      { t: 'line', x1: 0, y1: 28, x2: 100, y2: 28 },
    ],
  },
  sofa: {
    name: 'Sofa',
    w: 2000,
    h: 900,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'line', x1: 0, y1: 22, x2: 100, y2: 22 },
      { t: 'line', x1: 12, y1: 22, x2: 12, y2: 100 },
      { t: 'line', x1: 88, y1: 22, x2: 88, y2: 100 },
    ],
  },
  armchair: {
    name: 'Armchair',
    w: 900,
    h: 900,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'line', x1: 0, y1: 24, x2: 100, y2: 24 },
      { t: 'line', x1: 18, y1: 24, x2: 18, y2: 100 },
      { t: 'line', x1: 82, y1: 24, x2: 82, y2: 100 },
    ],
  },
  'dining-table': {
    name: 'Dining table',
    w: 1600,
    h: 900,
    prims: [
      { t: 'rect', x: 10, y: 15, w: 80, h: 70 },
      { t: 'circle', cx: 22, cy: 6, r: 6 },
      { t: 'circle', cx: 50, cy: 6, r: 6 },
      { t: 'circle', cx: 78, cy: 6, r: 6 },
      { t: 'circle', cx: 22, cy: 94, r: 6 },
      { t: 'circle', cx: 50, cy: 94, r: 6 },
      { t: 'circle', cx: 78, cy: 94, r: 6 },
    ],
  },
  'round-table': {
    name: 'Round table',
    w: 1100,
    h: 1100,
    prims: [
      { t: 'circle', cx: 50, cy: 50, r: 36 },
      { t: 'circle', cx: 50, cy: 7, r: 6 },
      { t: 'circle', cx: 93, cy: 50, r: 6 },
      { t: 'circle', cx: 50, cy: 93, r: 6 },
      { t: 'circle', cx: 7, cy: 50, r: 6 },
    ],
  },
  bath: {
    name: 'Bath',
    w: 1700,
    h: 750,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'rect', x: 7, y: 12, w: 86, h: 76 },
      { t: 'circle', cx: 15, cy: 50, r: 5 },
    ],
  },
  shower: {
    name: 'Shower',
    w: 900,
    h: 900,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'line', x1: 0, y1: 0, x2: 100, y2: 100 },
      { t: 'line', x1: 100, y1: 0, x2: 0, y2: 100 },
      { t: 'circle', cx: 50, cy: 50, r: 10 },
    ],
  },
  toilet: {
    name: 'WC',
    w: 600,
    h: 700,
    prims: [
      { t: 'rect', x: 15, y: 0, w: 70, h: 26 },
      { t: 'circle', cx: 50, cy: 62, r: 30 },
      { t: 'line', x1: 30, y1: 26, x2: 70, y2: 26 },
    ],
  },
  basin: {
    name: 'Basin',
    w: 550,
    h: 450,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'circle', cx: 50, cy: 52, r: 28 },
    ],
  },
  cooker: {
    name: 'Cooker / hob',
    w: 600,
    h: 600,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'circle', cx: 30, cy: 30, r: 13 },
      { t: 'circle', cx: 70, cy: 30, r: 13 },
      { t: 'circle', cx: 30, cy: 70, r: 13 },
      { t: 'circle', cx: 70, cy: 70, r: 13 },
    ],
  },
  fridge: {
    name: 'Fridge',
    w: 650,
    h: 650,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'line', x1: 0, y1: 0, x2: 20, y2: 20 },
      { t: 'line', x1: 100, y1: 0, x2: 80, y2: 20 },
      // Door handle, offset to one side (real fridge doors hinge on one
      // edge) — the one deliberately asymmetric detail, so "Mirror" has a
      // visible effect: it moves the handle to the other edge.
      { t: 'line', x1: 88, y1: 40, x2: 88, y2: 60 },
    ],
  },
  'kitchen-sink': {
    name: 'Kitchen sink',
    w: 1000,
    h: 550,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      // Main bowl (left) + a grooved drainer board (right) — the common
      // UK layout, and asymmetric on purpose so mirroring visibly swaps
      // which side the drainer is on.
      { t: 'rect', x: 8, y: 12, w: 46, h: 76 },
      { t: 'circle', cx: 31, cy: 50, r: 5 },
      { t: 'rect', x: 60, y: 12, w: 32, h: 76 },
      { t: 'line', x1: 66, y1: 22, x2: 86, y2: 22 },
      { t: 'line', x1: 66, y1: 40, x2: 86, y2: 40 },
      { t: 'line', x1: 66, y1: 58, x2: 86, y2: 58 },
      { t: 'line', x1: 66, y1: 76, x2: 86, y2: 76 },
    ],
  },
  wardrobe: {
    name: 'Wardrobe',
    w: 1200,
    h: 600,
    prims: [
      { t: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { t: 'line', x1: 50, y1: 0, x2: 50, y2: 100 },
      { t: 'line', x1: 0, y1: 50, x2: 100, y2: 50 },
    ],
  },
} as const satisfies Record<string, SymbolDef>;

export type SymbolKind = keyof typeof SYMBOL_DEFS;

export const SYMBOL_KINDS = Object.keys(SYMBOL_DEFS) as SymbolKind[];

export interface SymbolInstance {
  id: string;
  kind: SymbolKind;
  /** top-left of the (unrotated) footprint, mm */
  x: number;
  y: number;
  w: number;
  h: number;
  /** rotation about the footprint centre, degrees (0/90/180/270 typical) */
  rotationDeg: number;
  /** horizontal mirror in local (unrotated) space — read as `?? false` for docs saved before this field existed */
  mirrored?: boolean;
}
