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
  'Kitchen / Diner',
  'Bedroom',
  'Bathroom',
  'WC',
  'Hallway',
  'Stairs',
  'Utility',
  'Other',
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  /** mm */
  thickness: number;
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
}

export interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface FloorDoc {
  schemaVersion: 1;
  walls: Wall[];
  rooms: RoomRect[];
  labels: TextLabel[];
}

export type PropertyStatus = 'draft' | 'ready' | 'exported';

export const DEFAULT_WALL_THICKNESS_MM = 100;
export const DEFAULT_CEILING_HEIGHT_M = 2.4;
export const DEFAULT_GRID_MM = 100;
