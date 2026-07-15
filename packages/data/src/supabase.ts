import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyFloorDoc, type FloorDoc } from '@floorplan/core';
import type {
  FloorRecord,
  FloorRepository,
  PropertyInput,
  PropertyRecord,
  PropertyRepository,
  Repositories,
} from './types';

/**
 * Direct Supabase (Postgres + PostgREST) cloud repositories. This is real,
 * synchronous-online cloud sync — the client talks straight to the database
 * over HTTPS on every call, gated by the RLS policies in
 * supabase/migrations/0001_init.sql and the RPCs in 0002_app_functions.sql.
 *
 * This is deliberately NOT the PowerSync offline-first sync engine described
 * in the original plan: PowerSync needs a live PowerSync instance (schema,
 * sync rules, connector auth) to build and verify against, which doesn't
 * exist yet. Building that blind, with no way to test it, would be
 * speculative code that could silently be wrong. This adapter is instead a
 * real, reviewable, testable-in-isolation cloud backend that satisfies the
 * exact same `Repositories` contract as guest mode — true offline-first sync
 * remains a follow-up once a PowerSync project exists.
 */

interface PropertyRow {
  id: string;
  address_line1: string;
  address_line2: string;
  postcode: string;
  status: PropertyRecord['status'];
  created_at: string;
  updated_at: string;
  property_meta: Record<string, unknown> | null;
}

function rowToProperty(row: PropertyRow): PropertyRecord {
  const meta = row.property_meta ?? {};
  const record: PropertyRecord = {
    id: row.id,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postcode: row.postcode,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof meta.buildYear === 'number') record.buildYear = meta.buildYear;
  if (typeof meta.constructionType === 'string') {
    record.constructionType = meta.constructionType as PropertyRecord['constructionType'];
  }
  if (typeof meta.heatingSystem === 'string') record.heatingSystem = meta.heatingSystem as string;
  return record;
}

const PROPERTY_COLUMNS =
  'id, address_line1, address_line2, postcode, status, created_at, updated_at, property_meta';

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Supabase returned no data for a call expected to succeed.');
  return data;
}

export class SupabasePropertyRepository implements PropertyRepository {
  constructor(
    private client: SupabaseClient,
    private orgId: string,
  ) {}

  async list(): Promise<PropertyRecord[]> {
    const res = await this.client
      .from('properties')
      .select(PROPERTY_COLUMNS)
      .eq('org_id', this.orgId)
      .order('updated_at', { ascending: false });
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).map(rowToProperty);
  }

  async get(id: string): Promise<PropertyRecord | undefined> {
    const res = await this.client.from('properties').select(PROPERTY_COLUMNS).eq('id', id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? rowToProperty(res.data) : undefined;
  }

  async create(input: PropertyInput): Promise<PropertyRecord> {
    const res = await this.client
      .from('properties')
      .insert({
        org_id: this.orgId,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2 ?? '',
        postcode: input.postcode ?? '',
      })
      .select(PROPERTY_COLUMNS)
      .single();
    return rowToProperty(unwrap(res));
  }

  async update(
    id: string,
    patch: Partial<Omit<PropertyRecord, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const { buildYear, constructionType, heatingSystem, ...columns } = patch;
    if (Object.keys(columns).length > 0) {
      const dbColumns: Record<string, unknown> = {};
      if (columns.addressLine1 !== undefined) dbColumns.address_line1 = columns.addressLine1;
      if (columns.addressLine2 !== undefined) dbColumns.address_line2 = columns.addressLine2;
      if (columns.postcode !== undefined) dbColumns.postcode = columns.postcode;
      if (columns.status !== undefined) dbColumns.status = columns.status;
      dbColumns.updated_at = new Date().toISOString();
      const res = await this.client.from('properties').update(dbColumns).eq('id', id);
      if (res.error) throw new Error(res.error.message);
    }

    const meta: Record<string, unknown> = {};
    if (buildYear !== undefined) meta.buildYear = buildYear;
    if (constructionType !== undefined) meta.constructionType = constructionType;
    if (heatingSystem !== undefined) meta.heatingSystem = heatingSystem;
    if (Object.keys(meta).length > 0) {
      const res = await this.client.rpc('merge_property_meta', { p_id: id, p_meta: meta });
      if (res.error) throw new Error(res.error.message);
    }
  }

  async remove(id: string): Promise<void> {
    // FK cascades (properties -> plans -> floors -> floor_documents/floor_revisions)
    // handle the rest atomically server-side.
    const res = await this.client.from('properties').delete().eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }
}

export class SupabaseFloorRepository implements FloorRepository {
  constructor(private client: SupabaseClient) {}

  async listByProperty(propertyId: string): Promise<FloorRecord[]> {
    const res = await this.client.rpc('list_floors_for_property', { p_property_id: propertyId });
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as FloorRecord[];
  }

  async get(id: string): Promise<FloorRecord | undefined> {
    const res = await this.client.rpc('get_floor', { p_floor_id: id });
    if (res.error) throw new Error(res.error.message);
    return (res.data as FloorRecord | null) ?? undefined;
  }

  async create(propertyId: string, name: string, sortOrder: number): Promise<FloorRecord> {
    const res = await this.client.rpc('create_floor_for_property', {
      p_property_id: propertyId,
      p_name: name,
      p_sort_order: sortOrder,
      p_doc: emptyFloorDoc() as unknown as Record<string, unknown>,
    });
    return unwrap(res) as unknown as FloorRecord;
  }

  async saveDoc(id: string, doc: FloorDoc): Promise<void> {
    const res = await this.client.rpc('save_floor_doc', {
      p_floor_id: id,
      p_doc: doc as unknown as Record<string, unknown>,
    });
    if (res.error) throw new Error(res.error.message);
  }

  async rename(id: string, name: string): Promise<void> {
    const res = await this.client.from('floors').update({ name }).eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }

  async remove(id: string): Promise<void> {
    const res = await this.client.from('floors').delete().eq('id', id);
    if (res.error) throw new Error(res.error.message);
  }
}

export function createSupabaseRepositories(client: SupabaseClient, orgId: string): Repositories {
  return {
    properties: new SupabasePropertyRepository(client, orgId),
    floors: new SupabaseFloorRepository(client),
  };
}

/**
 * Returns the org id the signed-in user belongs to, creating one if this is
 * their first time (idempotent — safe to call on every sign-in).
 */
export async function ensureOrgForCurrentUser(client: SupabaseClient): Promise<string> {
  const res = await client.rpc('ensure_org_for_current_user');
  return unwrap(res) as unknown as string;
}

/**
 * Copies every guest (local IndexedDB) property and floor into the signed-in
 * user's cloud account. Non-destructive: guest data is left in place so nothing
 * is lost if the copy fails partway or the user wants to keep working offline.
 */
export async function adoptGuestDataToAccount(
  guestRepos: Repositories,
  cloudRepos: Repositories,
): Promise<{ properties: number; floors: number }> {
  const properties = await guestRepos.properties.list();
  let floorCount = 0;
  for (const property of properties) {
    const created = await cloudRepos.properties.create({
      addressLine1: property.addressLine1,
      addressLine2: property.addressLine2,
      postcode: property.postcode,
    });
    if (property.buildYear || property.constructionType || property.heatingSystem) {
      await cloudRepos.properties.update(created.id, {
        buildYear: property.buildYear,
        constructionType: property.constructionType,
        heatingSystem: property.heatingSystem,
        status: property.status,
      });
    } else if (property.status !== created.status) {
      await cloudRepos.properties.update(created.id, { status: property.status });
    }

    const floors = await guestRepos.floors.listByProperty(property.id);
    for (const floor of floors) {
      const createdFloor = await cloudRepos.floors.create(created.id, floor.name, floor.sortOrder);
      await cloudRepos.floors.saveDoc(createdFloor.id, floor.doc);
      floorCount += 1;
    }
  }
  return { properties: properties.length, floors: floorCount };
}
