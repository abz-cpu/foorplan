import Dexie, { type EntityTable } from 'dexie';
import { emptyFloorDoc, newId, type FloorDoc } from '@floorplan/core';
import type {
  FloorRecord,
  FloorRepository,
  PropertyInput,
  PropertyRecord,
  PropertyRepository,
  Repositories,
} from './types';

class StudioDb extends Dexie {
  properties!: EntityTable<PropertyRecord, 'id'>;
  floors!: EntityTable<FloorRecord, 'id'>;

  constructor() {
    super('floorplan-studio');
    // Schema version 1.
    // NOTE FOR FUTURE UPGRADES: Never edit version(1) once in production.
    // To migrate to version 2, declare a new version block:
    // this.version(2).stores({
    //   properties: 'id, updatedAt, status, buildYear', // example new index
    // }).upgrade(tx => {
    //   // Perform data transformation/default value migration
    // });
    this.version(1).stores({
      properties: 'id, updatedAt, status',
      floors: 'id, propertyId, [propertyId+sortOrder]',
    });
  }
}

const now = () => new Date().toISOString();

class GuestPropertyRepository implements PropertyRepository {
  constructor(private db: StudioDb) {}

  async list(): Promise<PropertyRecord[]> {
    const all = await this.db.properties.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Promise<PropertyRecord | undefined> {
    return this.db.properties.get(id);
  }

  async create(input: PropertyInput): Promise<PropertyRecord> {
    const ts = now();
    const record: PropertyRecord = {
      id: newId(),
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? '',
      postcode: input.postcode ?? '',
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    };
    await this.db.properties.add(record);
    return record;
  }

  async update(
    id: string,
    patch: Partial<Omit<PropertyRecord, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    await this.db.properties.update(id, { ...patch, updatedAt: now() });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.properties, this.db.floors, async () => {
      await this.db.floors.where('propertyId').equals(id).delete();
      await this.db.properties.delete(id);
    });
  }
}

class GuestFloorRepository implements FloorRepository {
  constructor(private db: StudioDb) {}

  async listByProperty(propertyId: string): Promise<FloorRecord[]> {
    const floors = await this.db.floors.where('propertyId').equals(propertyId).toArray();
    return floors.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  get(id: string): Promise<FloorRecord | undefined> {
    return this.db.floors.get(id);
  }

  async create(propertyId: string, name: string, sortOrder: number): Promise<FloorRecord> {
    const record: FloorRecord = {
      id: newId(),
      propertyId,
      name,
      sortOrder,
      doc: emptyFloorDoc(),
      updatedAt: now(),
    };
    await this.db.floors.add(record);
    return record;
  }

  async saveDoc(id: string, doc: FloorDoc): Promise<void> {
    await this.db.transaction('rw', this.db.floors, this.db.properties, async () => {
      const floor = await this.db.floors.get(id);
      if (!floor) return;
      await this.db.floors.update(id, { doc, updatedAt: now() });
      await this.db.properties.update(floor.propertyId, { updatedAt: now() });
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.floors.delete(id);
  }
}

export function createGuestRepositories(): Repositories {
  const db = new StudioDb();
  return {
    properties: new GuestPropertyRepository(db),
    floors: new GuestFloorRepository(db),
  };
}

/** Every property owns at least one floor — enforce the invariant at creation. */
export async function createPropertyWithGroundFloor(
  repos: Repositories,
  input: PropertyInput,
): Promise<{ property: PropertyRecord; floor: FloorRecord }> {
  const property = await repos.properties.create(input);
  const floor = await repos.floors.create(property.id, 'Ground Floor', 0);
  return { property, floor };
}
