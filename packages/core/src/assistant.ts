import { floorGiaM2, roomAreaM2 } from './geometry';
import { formatAreaM2 } from './format';
import type { FloorDoc, RoomRect, RoomType } from './types';

/**
 * On-device assistant heuristics. These run fully offline today; the same
 * surface swaps to a Claude API edge function when cloud sync is provisioned.
 */

export interface NameSuggestion {
  roomId: string;
  name: string;
  type: RoomType;
}

/** Rule-based room naming from size ordering — a sensible first draft. */
export function suggestRoomNames(doc: FloorDoc, floorIndex = 0): NameSuggestion[] {
  const candidates = doc.rooms.filter((r) => r.type !== 'Stairs');
  const bySize = [...candidates].sort((a, b) => roomAreaM2(b) - roomAreaM2(a));
  const suggestions: NameSuggestion[] = [];
  let bedroom = 0;

  bySize.forEach((room, i) => {
    const area = roomAreaM2(room);
    let name: string;
    let type: RoomType;
    if (floorIndex === 0 && i === 0) {
      name = 'Living Room';
      type = 'Living Room';
    } else if (floorIndex === 0 && i === 1 && area >= 8) {
      name = 'Kitchen/Diner';
      type = 'Kitchen / Diner';
    } else if (area < 2.5) {
      name = 'WC';
      type = 'WC';
    } else if (area < 5) {
      name = 'Bathroom';
      type = 'Bathroom';
    } else if (area < 7 && aspect(room) > 2.2) {
      name = 'Hallway';
      type = 'Hallway';
    } else {
      bedroom += 1;
      name = `Bedroom ${bedroom}`;
      type = 'Bedroom';
    }
    suggestions.push({ roomId: room.id, name, type });
  });
  return suggestions;
}

function aspect(room: RoomRect): number {
  return Math.max(room.w, room.h) / Math.max(Math.min(room.w, room.h), 1);
}

export interface DescriptionInput {
  address: string;
  floors: { name: string; doc: FloorDoc }[];
}

/** Template-based listing/EPC description draft from the plan data. */
export function generateDescription({ address, floors }: DescriptionInput): string {
  const allRooms = floors.flatMap((f) => f.doc.rooms);
  const beds = allRooms.filter((r) => r.type === 'Bedroom').length;
  const totalGia = floors.reduce((a, f) => a + floorGiaM2(f.doc), 0);
  const bedPhrase = beds > 0 ? `${beds}-bedroom ` : '';
  const floorPhrase =
    floors.length > 1 ? `arranged over ${floors.length} floors` : 'arranged on a single floor';

  const parts: string[] = [
    `A well-proportioned ${bedPhrase}home at ${address}, ${floorPhrase} and offering approximately ${formatAreaM2(totalGia)} of gross internal area.`,
  ];

  for (const floor of floors) {
    const named = floor.doc.rooms.filter((r) => r.type !== 'Stairs');
    if (named.length === 0) continue;
    const list = named
      .map((r) => `${r.name.toLowerCase()} (${formatAreaM2(roomAreaM2(r))})`)
      .join(', ');
    parts.push(`The ${floor.name.toLowerCase()} comprises: ${list}.`);
  }

  parts.push(
    'All measurements are approximate, taken from the floor plan, and should be verified on site.',
  );
  return parts.join(' ');
}
