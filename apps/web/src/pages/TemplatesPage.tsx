import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { docToThumbnailSvg, PLAN_TEMPLATES, type PlanTemplate } from '@floorplan/core';
import { useToast } from '@floorplan/ui';
import { AppNav } from '../components/AppNav';
import { NewPropertyDialog, type NewPropertyValues } from '../components/NewPropertyDialog';
import { repos } from '../lib/repos';

/**
 * Starter templates: pick a typical UK layout, type the address, and land in
 * the editor with every floor already drawn — walls, rooms, names, and a
 * front door — ready to be pulled to the surveyed dimensions.
 */
export function TemplatesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState<PlanTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  // Ground-floor preview per template, rendered once — the builders are pure.
  const previews = useMemo(
    () =>
      Object.fromEntries(
        PLAN_TEMPLATES.map((t) => [t.id, docToThumbnailSvg(t.buildFloors()[0].doc, { width: 320, height: 200 })]),
      ),
    [],
  );

  const createFromTemplate = async (tpl: PlanTemplate, values: NewPropertyValues) => {
    if (creating) return;
    setCreating(true);
    try {
      const property = await repos.properties.create({
        addressLine1: values.addressLine1,
        addressLine2: values.addressLine2,
        postcode: values.postcode,
      });
      const floors = tpl.buildFloors();
      for (let i = 0; i < floors.length; i++) {
        const record = await repos.floors.create(property.id, floors[i].name, i);
        await repos.floors.saveDoc(record.id, floors[i].doc);
      }
      toast(`Created from the ${tpl.name} template`);
      navigate(`/editor/${property.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the property');
      setCreating(false);
      setPending(null);
    }
  };

  return (
    <div className="min-h-dvh bg-shell">
      <AppNav active="templates" />
      <main className="mx-auto max-w-[1128px] px-4 pb-16 pt-8 md:px-6">
        <h1 className="text-[26px] font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          Start from a typical layout instead of a blank canvas — everything stays fully editable.
        </p>

        <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px,100%), 1fr))' }}>
          {PLAN_TEMPLATES.map((tpl) => (
            <div key={tpl.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-segment">
              <div
                className="flex h-[200px] items-center justify-center border-b border-line-soft bg-[#FBFDFC] p-4"
                // Trusted, locally generated SVG markup — same source as the
                // dashboard thumbnails.
                dangerouslySetInnerHTML={{ __html: previews[tpl.id] }}
              />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-bold tracking-tight">{tpl.name}</h2>
                  <span className="flex-none font-mono text-[11px] text-ink-ghost">{tpl.summary}</span>
                </div>
                <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-ink-faint">{tpl.description}</p>
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setPending(tpl)}
                  className="mt-3.5 h-[34px] w-full cursor-pointer rounded-[9px] bg-action text-[12.5px] font-semibold text-white hover:bg-action-hover disabled:cursor-default disabled:opacity-60"
                >
                  Use this template
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {pending && (
        <NewPropertyDialog
          onClose={() => (creating ? undefined : setPending(null))}
          onCreate={(values) => void createFromTemplate(pending, values)}
        />
      )}
    </div>
  );
}
