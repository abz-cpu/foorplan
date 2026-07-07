import { Link } from 'react-router-dom';
import { Clock, Download, MoveUpRight, Sparkles, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '@floorplan/core';
import { StatusPill } from '@floorplan/ui';
import type { DashboardProperty } from '../lib/useDashboardData';

export function PropertyCard({
  property,
  onDelete,
}: {
  property: DashboardProperty;
  onDelete: () => void;
}) {
  const { record, thumbnailSvg, meta } = property;
  return (
    <article className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-white transition-all hover:-translate-y-0.5 hover:border-[#CFDAD6] hover:shadow-card">
      <Link
        to={`/editor/${record.id}`}
        className="relative block h-[148px] bg-[#F2F6F4] [background-image:radial-gradient(#D9E3DF_1px,transparent_1px)] [background-size:13px_13px]"
      >
        <div
          className="absolute inset-0 p-3 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: thumbnailSvg }}
        />
        <span className="absolute left-2.5 top-2.5">
          <StatusPill status={record.status} />
        </span>
      </Link>

      <div className="flex-1 px-4 pb-3 pt-3.5">
        <div className="text-[15px] font-semibold tracking-tight">{record.addressLine1}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-faint">
          {[record.addressLine2, record.postcode].filter(Boolean).join(' ') || '—'}
        </div>
        <div className="mt-2.5 text-[12.5px] text-ink-soft">{meta}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-ghost">
          <Clock size={12} />
          Edited {formatRelativeTime(record.updatedAt)}
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-line-soft px-3 py-2.5">
        <Link
          to={`/editor/${record.id}`}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-action-soft px-3 text-[12.5px] font-semibold text-action-soft-ink hover:bg-action-soft-hover"
        >
          <MoveUpRight size={13} strokeWidth={2.2} />
          Open in Editor
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          title="AI: generate property description — coming soon"
          disabled
          className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg border border-line bg-white text-ai opacity-45"
        >
          <Sparkles size={15} strokeWidth={1.8} />
        </button>
        <Link
          to={`/editor/${record.id}?export=1`}
          title="Export plan"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-shell"
        >
          <Download size={15} />
        </Link>
        <button
          type="button"
          title="Delete property"
          onClick={onDelete}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-[#FBF0EF] hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

export function PropertyRow({
  property,
  onDelete,
}: {
  property: DashboardProperty;
  onDelete: () => void;
}) {
  const { record, thumbnailSvg, meta } = property;
  return (
    <div className="grid grid-cols-[1fr_120px_130px_150px] items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0 hover:bg-[#F7FAF9]">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="h-[42px] w-[62px] flex-none overflow-hidden rounded-[7px] border border-line bg-[#F2F6F4] p-1 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: thumbnailSvg }}
        />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold">{record.addressLine1}</div>
          <div className="truncate text-xs text-ink-faint">
            {[record.addressLine2, record.postcode].filter(Boolean).join(' ')}
            {meta ? ` · ${meta}` : ''}
          </div>
        </div>
      </div>
      <StatusPill status={record.status} />
      <span className="text-[12.5px] text-ink-soft">{formatRelativeTime(record.updatedAt)}</span>
      <div className="flex items-center justify-end gap-1.5">
        <Link
          to={`/editor/${record.id}`}
          className="flex h-[30px] items-center rounded-lg bg-action-soft px-3 text-xs font-semibold text-action-soft-ink hover:bg-action-soft-hover"
        >
          Open
        </Link>
        <Link
          to={`/editor/${record.id}?export=1`}
          title="Export plan"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-shell"
        >
          <Download size={14} />
        </Link>
        <button
          type="button"
          title="Delete property"
          onClick={onDelete}
          className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-line bg-white text-ink-mid hover:bg-[#FBF0EF] hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
