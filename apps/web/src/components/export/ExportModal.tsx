import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileText, Image, Trash2, Upload, X } from 'lucide-react';
import type { FloorDoc } from '@floorplan/core';
import {
  buildFloorSheet,
  canvasToBlob,
  downloadBlob,
  drawShapesToCanvas,
  shapesToPdfBytes,
  shapesToSvg,
  slugify,
  type ExportFormat,
  type Orientation,
  type PaperSize,
} from '@floorplan/export';
import { SegmentedControl, useToast } from '@floorplan/ui';
import { loadBrandProfile, readLogoFile, saveBrandProfile } from '../../lib/brand';

const EXPORT_DPI = 300;
const PX_PER_MM = EXPORT_DPI / 25.4;

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-2.5 px-0.5 py-2 text-left"
    >
      <span className="text-[13px] font-medium text-ink-mid">{label}</span>
      <span
        className="relative h-[21px] w-9 flex-none rounded-full transition-colors"
        style={{ background: checked ? '#0B7A5E' : '#C6D2CD' }}
      >
        <span
          className="absolute top-[2.5px] h-4 w-4 rounded-full bg-white shadow transition-[left]"
          style={{ left: checked ? 17.5 : 2.5 }}
        />
      </span>
    </button>
  );
}

export function ExportModal({
  address,
  floorName,
  doc,
  initialPlanMode = 'technical',
  onClose,
  onExported,
}: {
  address: string;
  floorName: string;
  doc: FloorDoc;
  /** The editor's live plan mode when Export was opened — used as this
   *  export's starting point, independently overridable below. */
  initialPlanMode?: 'technical' | 'presentation';
  onClose: () => void;
  onExported: (format: ExportFormat) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [measurements, setMeasurements] = useState(true);
  const [disclaimer, setDisclaimer] = useState(true);
  const [planMode, setPlanMode] = useState<'technical' | 'presentation'>(initialPlanMode);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [brand, setBrand] = useState(() => loadBrandProfile());
  const logoInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Persist the brand profile whenever it changes so it's reused next time.
  useEffect(() => saveBrandProfile(brand), [brand]);

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { dataUrl, aspect } = await readLogoFile(file);
      setBrand((b) => ({ ...b, logoDataUrl: dataUrl, logoAspect: aspect }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load that logo');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheet = useMemo(
    () =>
      buildFloorSheet(doc, {
        address,
        floorName,
        paper,
        orientation,
        showMeasurements: measurements,
        disclaimer,
        planMode,
        brand,
      }),
    [doc, address, floorName, paper, orientation, measurements, disclaimer, planMode, brand],
  );
  const previewSvg = useMemo(
    () => shapesToSvg(sheet.shapes, sheet.widthMm, sheet.heightMm),
    [sheet],
  );

  const ext = format === 'jpg' ? 'jpg' : format;
  const filename = `${slugify(address)}-${slugify(floorName)}.${ext}`;
  const meta = `${filename} · ${paper.toUpperCase()} ${orientation} · ${
    format === 'pdf' || format === 'svg' ? 'Vector' : `${EXPORT_DPI} DPI`
  }`;

  const generate = async () => {
    if (phase === 'working') return;
    setPhase('working');
    try {
      let blob: Blob;
      if (format === 'pdf') {
        const bytes = await shapesToPdfBytes(sheet.shapes, sheet.widthMm, sheet.heightMm);
        blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      } else if (format === 'svg') {
        blob = new Blob([previewSvg], { type: 'image/svg+xml' });
      } else {
        const canvas = document.createElement('canvas');
        await drawShapesToCanvas(canvas, sheet.shapes, sheet.widthMm, sheet.heightMm, PX_PER_MM);
        blob = await canvasToBlob(
          canvas,
          format === 'png' ? 'image/png' : 'image/jpeg',
          format === 'jpg' ? 0.92 : undefined,
        );
      }
      downloadBlob(filename, blob);
      setPhase('done');
      onExported(format);
      setTimeout(() => setPhase('idle'), 3000);
    } catch (err) {
      console.error('Export failed', err);
      setPhase('idle');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,30,26,0.44)] p-3 backdrop-blur-[3px] md:p-6" onClick={onClose}>
      <div
        className="flex max-h-[94dvh] w-[780px] max-w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-toast"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line-soft px-5 pb-4 pt-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Export Plan</h2>
            <p className="mt-1 text-[13px] text-ink-faint">
              {address} · {floorName}
            </p>
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

        {/* Body — options beside the preview on desktop, stacked above it
            (whole body scrolls) on phones. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[316px_1fr] md:overflow-visible">
          {/* Options */}
          <div className="flex flex-col gap-[17px] border-b border-line-soft px-5 pb-5 pt-4 md:overflow-y-auto md:border-b-0 md:border-r">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-mid">Format</div>
              <SegmentedControl
                options={[
                  {
                    value: 'pdf',
                    label: (
                      <>
                        <FileText size={14} /> PDF
                      </>
                    ),
                  },
                  {
                    value: 'png',
                    label: (
                      <>
                        <Image size={14} /> PNG
                      </>
                    ),
                  },
                ]}
                value={format === 'pdf' || format === 'png' ? format : 'png'}
                onChange={(v) => setFormat(v as ExportFormat)}
              />
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className="mt-2 h-8 w-full cursor-pointer rounded-lg border border-input bg-white px-2 text-xs text-ink-soft outline-none focus:border-action"
              >
                <option value="pdf">PDF — vector document</option>
                <option value="png">PNG — 300 DPI image</option>
                <option value="jpg">JPG — 300 DPI image</option>
                <option value="svg">SVG — editable vector</option>
              </select>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-mid">Paper size</div>
              <SegmentedControl
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'a3', label: 'A3' },
                ]}
                value={paper}
                onChange={setPaper}
              />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-mid">Orientation</div>
              <div className="grid grid-cols-2 gap-2">
                {(['portrait', 'landscape'] as const).map((o) => {
                  const active = orientation === o;
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[11px] border-[1.5px] px-2 pb-2.5 pt-3 text-[12.5px] font-semibold capitalize ${
                        active
                          ? 'border-action bg-action-soft text-action-soft-ink'
                          : 'border-input bg-white text-ink-soft'
                      }`}
                    >
                      <span
                        className={`rounded-[3px] border-2 border-current ${
                          o === 'portrait' ? 'h-6 w-[18px]' : 'my-[3px] h-[18px] w-6'
                        }`}
                      />
                      {o}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-mid">Room colour</div>
              <SegmentedControl
                options={[
                  { value: 'technical', label: 'Technical' },
                  { value: 'presentation', label: 'Coloured' },
                ]}
                value={planMode}
                onChange={(v) => setPlanMode(v as 'technical' | 'presentation')}
              />
            </div>

            <div>
              <div className="mb-0.5 text-xs font-semibold text-ink-mid">Options</div>
              <Toggle label="Include measurements" checked={measurements} onChange={setMeasurements} />
              <Toggle label="Include disclaimer" checked={disclaimer} onChange={setDisclaimer} />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-mid">Branding</div>
              <input
                value={brand.companyName ?? ''}
                onChange={(e) => setBrand((b) => ({ ...b, companyName: e.target.value }))}
                placeholder="Company name (e.g. L&D Energy)"
                className="h-8 w-full rounded-lg border border-input bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-action"
              />
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  void pickLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                {brand.logoDataUrl ? (
                  <img
                    src={brand.logoDataUrl}
                    alt="Logo preview"
                    className="h-9 max-w-[96px] rounded border border-line-soft bg-white object-contain p-0.5"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-input bg-white text-[12px] font-semibold text-ink-mid hover:bg-shell"
                >
                  <Upload size={13} /> {brand.logoDataUrl ? 'Replace logo' : 'Upload logo'}
                </button>
                {brand.logoDataUrl ? (
                  <button
                    type="button"
                    title="Remove logo"
                    onClick={() => setBrand((b) => ({ ...b, logoDataUrl: undefined, logoAspect: undefined }))}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-input bg-white text-ink-faint hover:bg-shell hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
              <textarea
                value={brand.disclaimerText ?? ''}
                onChange={(e) => setBrand((b) => ({ ...b, disclaimerText: e.target.value }))}
                placeholder="Custom disclaimer (optional — leave blank for the standard RICS wording)"
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-input bg-white px-2.5 py-1.5 text-[11.5px] leading-snug text-ink outline-none focus:border-action"
              />
              <p className="mt-1 text-[11px] text-ink-ghost">Saved on this device and reused for every export.</p>
            </div>
          </div>

          {/* Preview */}
          <div className="relative flex min-h-[300px] flex-none flex-col items-center justify-center bg-[#EDF2F0] p-5 md:min-h-[380px]">
            <span className="absolute right-3.5 top-3 rounded-md border border-line bg-white px-2 py-0.5 font-mono text-[10.5px] text-ink-faint">
              {paper.toUpperCase()} · {orientation === 'portrait' ? 'Portrait' : 'Landscape'} ·{' '}
              {format.toUpperCase()}
            </span>
            <div
              className="max-w-full rounded-[4px] bg-white shadow-card transition-all [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
              style={{
                width: orientation === 'portrait' ? 260 : 368,
                height: 'auto',
                aspectRatio: `${sheet.widthMm} / ${sheet.heightMm}`,
              }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-line-soft bg-canvas px-5 py-3.5">
          <span className="font-mono text-[11.5px] text-ink-faint">{meta}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 cursor-pointer items-center rounded-[9px] border border-input bg-white px-4 text-[13px] font-semibold text-ink-mid hover:bg-shell"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            className="flex h-9 min-w-[158px] cursor-pointer items-center justify-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white shadow-cta"
            style={{
              background: phase === 'done' ? '#17A578' : phase === 'working' ? '#5E9E8C' : '#0B7A5E',
            }}
          >
            {phase === 'done' ? <Check size={14} strokeWidth={2.5} /> : <Download size={14} strokeWidth={2.2} />}
            {phase === 'working' ? 'Preparing export…' : phase === 'done' ? 'Export ready' : 'Generate Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
