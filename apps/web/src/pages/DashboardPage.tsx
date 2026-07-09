import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Image, ImageOff, LayoutGrid, List, Search, Sparkles } from 'lucide-react';
import { buildDemoFloorDoc, type PropertyStatus } from '@floorplan/core';
import { createPropertyWithGroundFloor } from '@floorplan/data';
import { SegmentedControl, useToast } from '@floorplan/ui';
import { AppNav } from '../components/AppNav';
import { NewPropertyDialog, type NewPropertyValues } from '../components/NewPropertyDialog';
import { PropertyCard, PropertyRow } from '../components/PropertyCard';
import { repos } from '../lib/repos';
import { useDashboardData } from '../lib/useDashboardData';

type Tab = 'all' | PropertyStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'exported', label: 'Exported' },
];

const SHOW_THUMBNAILS_KEY = 'floorplan:showThumbnails';

export default function DashboardPage() {
  const { properties, loading, refresh } = useDashboardData();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dialogOpen, setDialogOpen] = useState(false);
  // 2-step confirm delete — avoids window.confirm which is blocked in
  // Capacitor Android WebViews. First click arms the confirm; second click
  // executes. Auto-disarms after 3 seconds.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(
    () => localStorage.getItem(SHOW_THUMBNAILS_KEY) !== 'off',
  );
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    localStorage.setItem(SHOW_THUMBNAILS_KEY, showThumbnails ? 'on' : 'off');
  }, [showThumbnails]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: properties.length, draft: 0, ready: 0, exported: 0 };
    for (const p of properties) c[p.record.status] += 1;
    return c;
  }, [properties]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return properties
      .filter((p) => tab === 'all' || p.record.status === tab)
      .filter(
        (p) =>
          !query ||
          `${p.record.addressLine1} ${p.record.addressLine2} ${p.record.postcode}`
            .toLowerCase()
            .includes(query),
      );
  }, [properties, tab, q]);

  const drafts = counts.draft;

  const handleCreate = async (values: NewPropertyValues) => {
    const { property } = await createPropertyWithGroundFloor(repos, values);
    setDialogOpen(false);
    toast(`${property.addressLine1} created`);
    navigate(`/editor/${property.id}`);
  };

  const handleCreateDemo = async () => {
    const { property, floor } = await createPropertyWithGroundFloor(repos, {
      addressLine1: '42 Sample Street',
      addressLine2: 'Demo flat — safe to edit or delete',
      postcode: 'SW1A 1AA',
    });
    await repos.floors.saveDoc(floor.id, buildDemoFloorDoc());
    toast('Demo plan created — explore it, or delete it any time');
    navigate(`/editor/${property.id}`);
  };

  const handleDeleteRequest = (id: string) => {
    if (confirmDeleteId === id) {
      // Second tap — execute
      void handleDeleteConfirmed(id);
    } else {
      // First tap — arm
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((prev) => (prev === id ? null : prev)), 3000);
    }
  };

  const handleDeleteConfirmed = async (id: string) => {
    const prop = properties.find((p) => p.record.id === id);
    const addr = prop?.record.addressLine1 ?? 'property';
    setConfirmDeleteId(null);
    await repos.properties.remove(id);
    await refresh();
    toast(`${addr} deleted`);
  };

  return (
    <div className="min-h-full">
      <AppNav onNewProperty={() => setDialogOpen(true)} />

      <main className="mx-auto max-w-[1180px] px-4 pb-18 pt-6 md:px-6 md:pt-8">
        <header>
          <h1 className="text-[26px] font-bold tracking-tight">My Properties</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {properties.length} propert{properties.length === 1 ? 'y' : 'ies'} · {drafts} draft
            {drafts === 1 ? '' : 's'} in progress
          </p>
        </header>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3.5">
          <SegmentedControl
            options={TABS.map((t) => ({
              value: t.value,
              label: (
                <>
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                      tab === t.value
                        ? 'bg-action-soft text-action-soft-ink'
                        : 'bg-[#DDE5E2] text-ink-soft'
                    }`}
                  >
                    {counts[t.value]}
                  </span>
                </>
              ),
            }))}
            value={tab}
            onChange={setTab}
          />

          <div className="flex w-full items-center gap-2.5 md:w-auto">
            <div className="relative min-w-0 flex-1 md:flex-none">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search address or postcode…"
                className="h-[37px] w-full rounded-[10px] border border-input bg-white pl-[34px] pr-3 text-[13px] text-ink outline-none placeholder:text-ink-ghost focus:border-action focus:ring-[3px] focus:ring-action/[0.13] md:w-[250px]"
              />
            </div>
            <button
              type="button"
              title={showThumbnails ? 'Hide thumbnails' : 'Show thumbnails'}
              onClick={() => setShowThumbnails((v) => !v)}
              className={`flex h-[37px] w-[37px] cursor-pointer items-center justify-center rounded-[10px] border transition-colors ${
                showThumbnails
                  ? 'border-line bg-white text-ink-mid hover:bg-shell'
                  : 'border-line bg-shell text-ink-ghost hover:bg-[#EBEFEC]'
              }`}
            >
              {showThumbnails ? <Image size={15} /> : <ImageOff size={15} />}
            </button>
            <SegmentedControl
              options={[
                { value: 'grid', label: <LayoutGrid size={15} />, title: 'Grid view' },
                { value: 'list', label: <List size={15} />, title: 'List view' },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
        </div>

        {loading ? (
          <div className="mt-5 rounded-[14px] border border-dashed border-[#CFDAD6] bg-white px-6 py-16 text-center text-[13px] text-ink-faint">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-5 rounded-[14px] border border-dashed border-[#CFDAD6] bg-white px-6 py-16 text-center">
            {properties.length === 0 ? (
              <>
                <div className="text-[15px] font-semibold text-ink-mid">
                  Draw your first floor plan
                </div>
                <div className="mt-1.5 text-[13px] text-ink-faint">
                  Create a property to open the editor — everything is saved on this device.
                </div>
                <div className="mt-4 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDialogOpen(true)}
                    className="inline-flex h-[37px] cursor-pointer items-center gap-2 rounded-[9px] bg-action px-4 text-[13.5px] font-semibold text-white shadow-cta hover:bg-action-hover"
                  >
                    New Property
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateDemo()}
                    title="Creates a small sample flat you can explore, edit, or delete"
                    className="inline-flex h-[37px] cursor-pointer items-center gap-2 rounded-[9px] border border-line bg-white px-4 text-[13.5px] font-semibold text-ink-mid shadow-segment hover:bg-shell"
                  >
                    <Sparkles size={14} />
                    Try a demo plan
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-[15px] font-semibold text-ink-mid">No properties match</div>
                <div className="mt-1.5 text-[13px] text-ink-faint">
                  Try a different search term or filter.
                </div>
              </>
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-[18px]">
            {filtered.map((p) => (
              <PropertyCard
                key={p.record.id}
                property={p}
                showThumbnail={showThumbnails}
                confirmingDelete={confirmDeleteId === p.record.id}
                onDelete={() => handleDeleteRequest(p.record.id)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[14px] border border-line bg-white">
            <div className="hidden grid-cols-[1fr_120px_130px_150px] items-center gap-3 border-b border-line-soft bg-[#F7FAF9] px-4 py-2 text-[11px] font-semibold tracking-wider text-ink-faint md:grid">
              <span>PROPERTY</span>
              <span>STATUS</span>
              <span>LAST EDITED</span>
              <span className="text-right">ACTIONS</span>
            </div>
            {filtered.map((p) => (
              <PropertyRow
                key={p.record.id}
                property={p}
                showThumbnail={showThumbnails}
                confirmingDelete={confirmDeleteId === p.record.id}
                onDelete={() => handleDeleteRequest(p.record.id)}
              />
            ))}
          </div>
        )}
      </main>

      {dialogOpen && (
        <NewPropertyDialog onCreate={handleCreate} onClose={() => setDialogOpen(false)} />
      )}

      {/* Dismiss armed confirm when the user clicks anywhere else */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-0" onClick={() => setConfirmDeleteId(null)} />
      )}
    </div>
  );
}
