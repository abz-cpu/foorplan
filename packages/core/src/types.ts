/**
 * Document model for a single floor of a plan.
 * All coordinates and lengths are in millimetres in world space.
 */

export interface Point {
  x: number;
  y: number;
}

export const ROOM_TYPES = [
  'Living Room',
  'Lounge',
  'Kitchen / Diner',
  'Dining Room',
  'Bedroom',
  'Bathroom',
  'WC',
  'Hallway',
  'Study',
  'Conservatory',
  'Garage',
  'Porch',
  'Stairs',
  'Utility',
  'Other',
] as const;

/** UI display names where the stored type value reads too tersely. Stored
 *  values never change (they're persisted in every doc). */
export const ROOM_TYPE_LABELS: Record<string, string> = {
  WC: 'WC / Toilet',
};

export function roomTypeLabel(type: string): string {
  return ROOM_TYPE_LABELS[type] ?? type;
}

export type RoomType = (typeof ROOM_TYPES)[number];

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  /** mm */
  thickness: number;
  /** Overrides the PRINTED length label only (site-measured value when the
   *  drawn geometry doesn't quite match) — never changes the geometry. */
  displayLengthMm?: number;
}

export interface RoomRect {
  id: string;
  /** top-left corner, mm */
  x: number;
  y: number;
  /** mm, always > 0 */
  w: number;
  h: number;
  name: string;
  type: RoomType;
  ceilingHeightM: number;
  includeInGia: boolean;
  /** Stairs only: which way the up/down arrow points. Undefined = 'forward'. */
  stairDirection?: 'forward' | 'reversed';
  /** Stairs only: flight shape. Undefined = 'straight'. */
  stairStyle?: 'straight' | 'uturn' | 'spiral';
  /** How far the name/area label has been dragged from the room's centre,
   *  mm — lets the label be moved off furniture placed mid-room.
   *  Undefined = centred (with a smart auto-nudge off furniture/walls). */
  labelOffset?: Point;
  /** Font scale for the name/area label, resized by its on-canvas handle.
   *  Undefined = 1 (default size). */
  labelScale?: number;
  /** Override the PRINTED width/length line only (site-measured values when
   *  the drawing isn't exact) — never changes the drawn rectangle. */
  displayWMm?: number;
  displayLMm?: number;
  /** Custom fill colour (hex) for this specific room, overriding the
   *  by-type zone colour — lets two bedrooms read differently, or any room
   *  take a bespoke colour. Undefined = the room-type colour. */
  color?: string;
  /** Show only the room name — no area or width×length lines. For a hallway
   *  or landing an assessor may want a bare label. Undefined/false = full. */
  hideAreaLabel?: boolean;
  /** Non-rectangular rooms (bays, chamfers, L/T/U shapes) carry their exact
   *  outline here, in absolute mm. When present it's the room's true shape
   *  and x/y/w/h are its bounding box (kept for selection fallback and
   *  back-compat). Undefined = a plain rectangle described by x/y/w/h. */
  polygon?: Point[];
}

export interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  /** Font scale, resized by the label's on-canvas handle. Undefined = 1. */
  scale?: number;
  /** Heading style: bigger + bold — for titling structures drawn side by
   *  side on one canvas ("Ground Floor", "First Floor"). */
  heading?: boolean;
  /** Heading labels only: also stamp the titled floor's total area and
   *  ceiling height beneath the name. Undefined = show them (a heading is a
   *  floor stamp by default). Set false for a bare title. */
  floorStamp?: boolean;
  /** Heading labels only: ceiling height in m to print in the stamp,
   *  overriding the value derived from that floor's rooms. */
  heightM?: number;
}

/** A door or window cut into a wall, positioned along it. */
export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  /** centre of the opening measured along the wall from endpoint `a`, mm */
  offsetMm: number;
  widthMm: number;
  /** door only: which jamb carries the hinge (relative to a→b direction) */
  hinge: 'left' | 'right';
  /** door only: which side of the wall the door swings toward — 'a' is
   *  wallNormal(wall) as-is, 'b' is the opposite side. Undefined = 'a'. */
  swingSide?: 'a' | 'b';
  /** door only: leaf arrangement. Undefined = 'single'. */
  doorStyle?: 'single' | 'double' | 'sliding';
  /** door only: how far the leaf/swing arc projects, mm — lets a door show a
   *  shallower swing (e.g. it can't fully open) while the opening in the wall
   *  keeps its width. Undefined = widthMm (a full quarter-circle swing). */
  swingDepthMm?: number;
  /** window only: 'bay' bumps out as an angled projection, 'box' as a square
   *  one — drawn as plan graphics outside the wall line. Undefined = 'standard'. */
  windowStyle?: 'standard' | 'bay' | 'box';
}

/** Reference photo (sketch/old plan) rendered under the grid for tracing. */
export interface Underlay {
  dataUrl: string;
  xMm: number;
  yMm: number;
  /** rendered width in world mm (height follows the image aspect) */
  widthMm: number;
  /** 0..1 */
  opacity: number;
  locked: boolean;
}

export interface FloorDoc {
  schemaVersion: 1;
  walls: Wall[];
  rooms: RoomRect[];
  labels: TextLabel[];
  openings: Opening[];
  symbols: import('./symbols').SymbolInstance[];
  underlay?: Underlay | null;
  /** Degrees clockwise the North arrow is rotated from straight up (0 = up). */
  northAngleDeg?: number;
}

export type PropertyStatus = 'draft' | 'ready' | 'exported';

export const DEFAULT_WALL_THICKNESS_MM = 100;
/** Typical masonry/cavity wall thickness — applied to boundary walls by
 *  "Auto-set wall thickness" (see measure.ts's classifyExternalWalls). */
export const EXTERNAL_WALL_THICKNESS_MM = 200;
/** Standard residential floor-to-ceiling height (m). Every room defaults to
 *  this regardless of which tool drew it, so RdSAP / volume data stays
 *  consistent across the app. */
export const DEFAULT_CEILING_HEIGHT_M = 2.735;
export const DEFAULT_GRID_MM = 100;
export const DEFAULT_DOOR_WIDTH_MM = 826;
export const DEFAULT_WINDOW_WIDTH_MM = 1200;
