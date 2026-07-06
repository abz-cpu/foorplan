import { createGuestRepositories } from '@floorplan/data';

/** Guest-mode repositories (IndexedDB). Swapped for the PowerSync-backed
 *  implementation when cloud sync ships — the app only sees the interfaces. */
export const repos = createGuestRepositories();
