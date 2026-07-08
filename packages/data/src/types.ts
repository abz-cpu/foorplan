import type { FloorDoc, PropertyStatus } from '@floorplan/core';

/**
 * Repository layer. The app only ever talks to these interfaces.
 * Today they are backed by IndexedDB (guest mode / local-first);
 * the PowerSync + Supabase adapter implements the same interfaces later,
 * which is what makes guest→account adoption and sync a drop-in change.
 */

export interface PropertyRecord {
  id: string;
  addressLine1: string;
  addressLine2: string;
  postcode: string;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
  /** EPC Phase 2: property-level metadata for SAP/RDSAP input */
  buildYear?: number;
  constructionType?: 'masonry' | 'timber-frame' | 'steel-frame' | 'unknown';
  heatingSystem?: string;
}

export interface FloorRecord {
  id: string;
  propertyId: string;
  name: string;
  sortOrder: number;
  doc: FloorDoc;
  updatedAt: string;
}

export interface PropertyInput {
  addressLine1: string;
  addressLine2?: string;
  postcode?: string;
}

export interface PropertyRepository {
  list(): Promise<PropertyRecord[]>;
  get(id: string): Promise<PropertyRecord | undefined>;
  create(input: PropertyInput): Promise<PropertyRecord>;
  update(
    id: string,
    patch: Partial<Omit<PropertyRecord, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void>;
  /** Deletes the property and all of its floors. */
  remove(id: string): Promise<void>;
}

export interface FloorRepository {
  listByProperty(propertyId: string): Promise<FloorRecord[]>;
  get(id: string): Promise<FloorRecord | undefined>;
  create(propertyId: string, name: string, sortOrder: number): Promise<FloorRecord>;
  saveDoc(id: string, doc: FloorDoc): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Repositories {
  properties: PropertyRepository;
  floors: FloorRepository;
}
