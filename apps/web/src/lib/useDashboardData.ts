import { useCallback, useEffect, useState } from 'react';
import { docToThumbnailSvg, floorGiaM2, formatAreaM2 } from '@floorplan/core';
import type { FloorRecord, PropertyRecord } from '@floorplan/data';
import { repos } from './repos';

export interface DashboardProperty {
  record: PropertyRecord;
  floors: FloorRecord[];
  thumbnailSvg: string;
  meta: string;
}

function buildMeta(floors: FloorRecord[]): string {
  const roomCount = floors.reduce((n, f) => n + f.doc.rooms.length, 0);
  const gia = floors.reduce((a, f) => a + floorGiaM2(f.doc), 0);
  const parts = [
    `${roomCount} room${roomCount === 1 ? '' : 's'}`,
    formatAreaM2(gia, 1),
    `${floors.length} floor${floors.length === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

export function useDashboardData() {
  const [properties, setProperties] = useState<DashboardProperty[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const records = await repos.properties.list();
    const withFloors = await Promise.all(
      records.map(async (record) => {
        const floors = await repos.floors.listByProperty(record.id);
        return {
          record,
          floors,
          thumbnailSvg: docToThumbnailSvg(floors[0]?.doc ?? { schemaVersion: 1 as const, walls: [], rooms: [], labels: [] }),
          meta: buildMeta(floors),
        };
      }),
    );
    setProperties(withFloors);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { properties, loading, refresh };
}
