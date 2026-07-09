import { Download, X } from 'lucide-react';
import {
  floorFootprint,
  floorGiaM2,
  formatAreaM2,
  formatMmAsM,
  roomAreaM2,
  type FloorDoc,
} from '@floorplan/core';

export interface ScheduleFloor {
  id: string;
  name: string;
  doc: FloorDoc;
}

export function RoomScheduleModal({
  address,
  floors,
  onClose,
  onDownloadCsv,
}: {
  address: string;
  floors: ScheduleFloor[];
  onClose: () => void;
  onDownloadCsv: () => void;
}) {
  const totalGia = floors.reduce((a, f) => a + floorGiaM2(f.doc), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,30,26,0.44)] p-6 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[760px] max-w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-toast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line-soft px-5 pb-4 pt-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Room Schedule</h2>
            <p className="mt-1 text-[13px] text-ink-faint">{address}</p>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] text-ink-faint hover:bg-shell hover:text-ink"
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {floors.map((floor) => {
            const fp = floorFootprint(floor.doc);
            const rooms = floor.doc.rooms;
            return (
              <div key={floor.id} className="mb-6 last:mb-0">
                <div className="mb-2 text-[13px] font-semibold text-ink-mid">{floor.name}</div>
                {rooms.length === 0 ? (
                  <p className="text-[12.5px] text-ink-ghost">No rooms drawn on this floor yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-[10px] border border-line-soft">
                    <table className="w-full min-w-[540px] border-collapse text-[12.5px]">
                      <thead>
                        <tr className="bg-[#F7FAF9] text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                          <th className="px-3 py-2">Room</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2 text-right">Width</th>
                          <th className="px-3 py-2 text-right">Length</th>
                          <th className="px-3 py-2 text-right">Area</th>
                          <th className="px-3 py-2 text-right">Ceiling</th>
                          <th className="px-3 py-2 text-center">GIA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.map((r) => (
                          <tr key={r.id} className="border-t border-line-soft">
                            <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                            <td className="px-3 py-2 text-ink-soft">{r.type}</td>
                            <td className="px-3 py-2 text-right font-mono text-ink-soft">
                              {formatMmAsM(r.w)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-ink-soft">
                              {formatMmAsM(r.h)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-ink">
                              {formatAreaM2(roomAreaM2(r), 2)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-ink-soft">
                              {r.ceilingHeightM.toFixed(2)} m
                            </td>
                            <td className="px-3 py-2 text-center">{r.includeInGia ? '✓' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line-soft bg-[#F7FAF9] font-semibold text-ink-mid">
                          <td className="px-3 py-2" colSpan={4}>
                            Floor totals
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-action-soft-ink">
                            {formatAreaM2(floorGiaM2(floor.doc), 2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono" colSpan={2}>
                            {fp.exposedPerimeterM.toFixed(2)} m perimeter
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-line-soft bg-canvas px-5 py-3.5">
          <span className="text-[13px] font-semibold text-ink-mid">
            Total GIA across {floors.length} floor{floors.length === 1 ? '' : 's'}
          </span>
          <span className="font-mono text-sm font-medium text-action-soft-ink">
            {formatAreaM2(totalGia, 2)}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onDownloadCsv}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-[9px] border border-input bg-white px-4 text-[13px] font-semibold text-ink-mid hover:bg-shell"
          >
            <Download size={14} />
            Download CSV
          </button>
        </div>
      </div>
    </div>
  );
}
