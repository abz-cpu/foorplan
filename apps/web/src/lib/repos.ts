import {
  createGuestRepositories,
  createSupabaseRepositories,
  ensureOrgForCurrentUser,
  type FloorRepository,
  type PropertyRepository,
  type Repositories,
} from '@floorplan/data';
import { getSupabaseClient } from './supabase';

/** Guest-mode repositories (IndexedDB) — always available, even offline. */
export const guestRepos = createGuestRepositories();

const client = getSupabaseClient();

let cachedUserId: string | null = null;
let cachedCloudRepos: Repositories | null = null;

client?.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user.id ?? null;
  if (uid !== cachedUserId) {
    cachedUserId = uid;
    cachedCloudRepos = null;
  }
});

/**
 * Resolves to cloud repos when a Supabase project is configured AND the user
 * is signed in; falls back to guest (local) repos otherwise. This is the one
 * place that decides guest vs cloud, so every call site in the app can keep
 * importing the static `repos` object below unchanged.
 */
async function resolveRepos(): Promise<Repositories> {
  if (!client) return guestRepos;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return guestRepos;

  if (cachedCloudRepos && cachedUserId === session.user.id) return cachedCloudRepos;
  const orgId = await ensureOrgForCurrentUser(client);
  cachedUserId = session.user.id;
  cachedCloudRepos = createSupabaseRepositories(client, orgId);
  return cachedCloudRepos;
}

function delegatingPropertyRepository(): PropertyRepository {
  return {
    list: async () => (await resolveRepos()).properties.list(),
    get: async (id) => (await resolveRepos()).properties.get(id),
    create: async (input) => (await resolveRepos()).properties.create(input),
    update: async (id, patch) => (await resolveRepos()).properties.update(id, patch),
    remove: async (id) => (await resolveRepos()).properties.remove(id),
  };
}

function delegatingFloorRepository(): FloorRepository {
  return {
    listByProperty: async (propertyId) => (await resolveRepos()).floors.listByProperty(propertyId),
    get: async (id) => (await resolveRepos()).floors.get(id),
    create: async (propertyId, name, sortOrder) =>
      (await resolveRepos()).floors.create(propertyId, name, sortOrder),
    saveDoc: async (id, doc) => (await resolveRepos()).floors.saveDoc(id, doc),
    remove: async (id) => (await resolveRepos()).floors.remove(id),
  };
}

/** Repositories the rest of the app talks to — guest or cloud, decided per call. */
export const repos: Repositories = {
  properties: delegatingPropertyRepository(),
  floors: delegatingFloorRepository(),
};
