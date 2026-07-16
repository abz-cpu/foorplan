import {
  docBounds,
  docToShapes,
  floorCeilingHeightM,
  floorGiaM2,
  floorHasMixedCeilings,
  formatArea,
  transformShapes,
  type AreaUnits,
  type FloorDoc,
  type Point,
  type Shape,
} from '@floorplan/core';

export type PaperSize = 'a4' | 'a3';
export type Orientation = 'portrait' | 'landscape';
export type ExportFormat = 'pdf' | 'png' | 'jpg' | 'svg';

const PAPER_MM: Record<PaperSize, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
};

/** Reusable company branding stamped onto the exported sheet. All optional —
 *  anything omitted falls back to the built-in L&D Energy defaults. */
export interface BrandProfile {
  companyName?: string;
  /** data: URL (PNG/JPEG) of the company logo */
  logoDataUrl?: string;
  /** logo width ÷ height, so the sheet can size it without decoding it */
  logoAspect?: number;
  /** overrides the standard RICS disclaimer wording */
  disclaimerText?: string;
}

export interface SheetOptions {
  address: string;
  floorName: string;
  paper: PaperSize;
  orientation: Orientation;
  showMeasurements: boolean;
  disclaimer: boolean;
  /** 'presentation' carries the editor's zonal room-color shading into the
   *  exported sheet; 'technical' (default) keeps the plain line-art look. */
  planMode?: 'technical' | 'presentation';
  /** Company branding for the header/footer. */
  brand?: BrandProfile;
  /** Display units for areas (GIA + room labels) — m², ft², or both. */
  areaUnits?: AreaUnits;
  /** Scale bar in the bottom-left corner (default on, always a 0.5 m rule). */
  showScaleBar?: boolean;
  /** Compass detail: bare north arrow (default), the four cardinals, or the
   *  full 8-point rose. 'none' hides it. */
  compass?: 'arrow' | 'nsew' | 'eight' | 'none';
}

/** A composed export sheet: shapes in paper-millimetre coordinates. */
export interface Sheet {
  widthMm: number;
  heightMm: number;
  shapes: Shape[];
}

const INK = '#10201C';
const GHOST = '#8A9A94';
const RULE = '#EEF2F1';
const BRAND = '#0E3E36';

export const DISCLAIMER_TEXT =
  'Produced by L&D Energy. This plan is for illustrative purposes only and is not to scale. ' +
  'Measurements are approximate and follow RICS guidance; they should not be relied upon for ' +
  'valuation, flooring or furnishing purposes.';

/** Rotates `p` around `center` by `deg` clockwise (screen/paper y-down coords). */
function rotatePoint(p: Point, center: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Compose a branded export sheet for one floor. */
export function buildFloorSheet(doc: FloorDoc, opts: SheetOptions): Sheet {
  const [pw, ph] = PAPER_MM[opts.paper];
  const [W, H] = opts.orientation === 'portrait' ? [pw, ph] : [ph, pw];
  const margin = 12;
  const headerH = 17;

  const shapes: Shape[] = [];
  const brand = opts.brand ?? {};

  /* Header: address + floor/GIA, brand mark (logo or company name) right.
     When several storeys are drawn on one sheet (≥2 heading "floor stamps"),
     the header stops asserting a single floor/ceiling — each stamp carries
     its own — and reports the whole-sheet total instead. */
  const floorHeadings = doc.labels.filter((l) => l.heading);
  const multiFloor = floorHeadings.length >= 2;
  const subtitle = multiFloor
    ? `${floorHeadings.length} floors · Total GIA ${formatArea(floorGiaM2(doc), opts.areaUnits ?? 'm2')}`
    : `${opts.floorName} · Approx. GIA ${formatArea(floorGiaM2(doc), opts.areaUnits ?? 'm2')}` +
      (doc.rooms.length > 0
        ? ` · Ceiling ${floorCeilingHeightM(doc).toFixed(2)}m${floorHasMixedCeilings(doc) ? ' (typical)' : ''}`
        : '');
  shapes.push(
    { kind: 'text', x: margin, y: margin + 4.6, text: opts.address, size: 5, color: INK, font: 'sans', weight: 700, align: 'left' },
    {
      kind: 'text',
      x: margin,
      y: margin + 9.6,
      text: subtitle,
      size: 3.1,
      color: GHOST,
      font: 'sans',
      align: 'left',
    },
  );
  const company = (brand.companyName && brand.companyName.trim()) || (brand.logoDataUrl ? '' : 'L&D ENERGY');
  if (brand.logoDataUrl) {
    // Right-aligned logo, larger, capped to the header band. A typed company
    // name sits to its LEFT, vertically centred, so it never crowds the rule.
    const logoH = 11.5;
    const aspect = brand.logoAspect && brand.logoAspect > 0 ? brand.logoAspect : 3;
    const logoW = Math.min(logoH * aspect, 62);
    shapes.push({
      kind: 'image',
      x: W - margin - logoW,
      y: margin,
      w: logoW,
      h: logoH,
      href: brand.logoDataUrl,
    });
    if (company) {
      shapes.push({
        kind: 'text',
        x: W - margin - logoW - 3.5,
        y: margin + logoH / 2 + 1,
        text: company,
        size: 3.0,
        color: '#33433E',
        font: 'sans',
        weight: 600,
        align: 'right',
      });
    }
  } else {
    // No logo: a bold company name is the brand mark.
    shapes.push(
      { kind: 'rect', x: W - margin - 27.5, y: margin + 0.6, w: 4.2, h: 4.2, fill: BRAND },
      {
        kind: 'text',
        x: W - margin,
        y: margin + 4,
        text: company.toUpperCase(),
        size: 3.4,
        color: BRAND,
        font: 'sans',
        weight: 700,
        align: 'right',
      },
    );
  }
  shapes.push({ kind: 'line', x1: margin, y1: margin + headerH - 2.5, x2: W - margin, y2: margin + headerH - 2.5, stroke: RULE, width: 0.4 });

  /* Footer disclaimer */
  let footerH = 0;
  if (opts.disclaimer) {
    const size = 2.2;
    const text = (brand.disclaimerText && brand.disclaimerText.trim()) || DISCLAIMER_TEXT;
    const lines = wrapText(text, Math.floor((W - margin * 2) / (size * 0.5)));
    footerH = lines.length * (size * 1.5) + 4;
    shapes.push({
      kind: 'line',
      x1: margin,
      y1: H - margin - footerH + 1,
      x2: W - margin,
      y2: H - margin - footerH + 1,
      stroke: RULE,
      width: 0.4,
    });
    lines.forEach((line, i) => {
      shapes.push({
        kind: 'text',
        x: margin,
        y: H - margin - footerH + 5 + i * size * 1.5,
        text: line,
        size,
        color: GHOST,
        font: 'sans',
        align: 'left',
      });
    });
  }

  /* Plan content, scaled to fit the content box */
  const cx0 = margin;
  const cy0 = margin + headerH;
  const cw = W - margin * 2;
  const ch = H - margin * 2 - headerH - footerH;

  const bounds = docBounds(doc);
  if (bounds && cw > 0 && ch > 0) {
    const pad = opts.showMeasurements ? 800 : 250; // world-mm padding for dimension lines
    const minX = bounds.minX - pad;
    const minY = bounds.minY - pad;
    const spanX = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
    const scale = Math.min(cw / spanX, ch / spanY);
    const dx = cx0 + (cw - spanX * scale) / 2 - minX * scale;
    const dy = cy0 + (ch - spanY * scale) / 2 - minY * scale;
    const planShapes = docToShapes(doc, {
      showDims: opts.showMeasurements,
      showLabels: true,
      planMode: opts.planMode,
      areaUnits: opts.areaUnits,
    });
    shapes.push(...transformShapes(planShapes, scale, dx, dy));

    /* Scale bar (bottom-left of content box) — always a compact 0.5 m rule,
       hidden when it would be an unreadable sliver or the user turned it off. */
    if (opts.showMeasurements && (opts.showScaleBar ?? true) && 500 * scale >= 2.5 && 500 * scale <= cw / 2) {
      const niceWorldMm = 500;
      const barLen = niceWorldMm * scale;
      const bx = cx0 + 2;
      const by = cy0 + ch - 4;
      shapes.push(
        { kind: 'line', x1: bx, y1: by, x2: bx + barLen, y2: by, stroke: '#4A5D57', width: 0.5 },
        { kind: 'line', x1: bx, y1: by - 1.4, x2: bx, y2: by + 1.4, stroke: '#4A5D57', width: 0.5 },
        { kind: 'line', x1: bx + barLen, y1: by - 1.4, x2: bx + barLen, y2: by + 1.4, stroke: '#4A5D57', width: 0.5 },
        {
          kind: 'text',
          x: bx + barLen / 2,
          y: by - 2.2,
          text: `${niceWorldMm >= 1000 ? niceWorldMm / 1000 : (niceWorldMm / 1000).toFixed(1)} m`,
          size: 2.6,
          color: '#4A5D57',
          font: 'mono',
          align: 'center',
        },
      );
    }

    /* Compass (top-right of content box), rotated to the plan's stored north
       direction — 0deg (default) points straight up the page. The 'N' (and
       any other cardinals) sit on a ring just outside the circle along their
       own rotated direction, so a rotated north never strands the label. */
    const compass = opts.compass ?? 'arrow';
    if (compass !== 'none') {
      const nx = cx0 + cw - 8;
      const ny = cy0 + 10;
      const center: Point = { x: nx, y: ny };
      const northDeg = doc.northAngleDeg ?? 0;
      const r = 4.4;
      const arrowPts = [
        { x: nx - 1.6, y: ny + 2.2 },
        { x: nx, y: ny - 2.6 },
        { x: nx + 1.6, y: ny + 2.2 },
        { x: nx, y: ny + 1 },
        { x: nx - 1.6, y: ny + 2.2 },
      ].map((p) => rotatePoint(p, center, northDeg));
      shapes.push(
        { kind: 'arc', cx: nx, cy: ny, r, startDeg: 0, endDeg: 359.99, anticlockwise: false, stroke: '#7C9A90', width: 0.4 },
        { kind: 'polyline', points: arrowPts, stroke: '#4A5D57', width: 0.5 },
      );
      const cardinal = (label: string, deg: number, size: number, color: string, weight: number) => {
        const rad = ((deg + northDeg - 90) * Math.PI) / 180;
        const dist = r + 2.4;
        shapes.push({
          kind: 'text',
          x: nx + Math.cos(rad) * dist,
          y: ny + Math.sin(rad) * dist + size * 0.35, // optical baseline centring
          text: label,
          size,
          color,
          font: 'sans',
          weight,
          align: 'center',
        });
      };
      cardinal('N', 0, 2.6, '#B14E39', 700);
      if (compass === 'nsew' || compass === 'eight') {
        cardinal('E', 90, 2.2, '#4A5D57', 600);
        cardinal('S', 180, 2.2, '#4A5D57', 600);
        cardinal('W', 270, 2.2, '#4A5D57', 600);
      }
      if (compass === 'eight') {
        for (const [label, deg] of [['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]] as const) {
          cardinal(label, deg, 1.5, '#8A9A94', 500);
        }
      }
    }
  }

  // "Made with" credit — always present, hyperlinked (SVG/PDF) back to the
  // app so anyone who receives the plan can find where it was produced.
  shapes.push({
    kind: 'text',
    x: W / 2,
    y: H - 4,
    text: 'Made with Floor Plan Studio · floorplan.luminousanddeliver.co.uk',
    size: 2.1,
    color: '#9AA8A3',
    font: 'sans',
    align: 'center',
    href: 'https://floorplan.luminousanddeliver.co.uk/',
  });

  return { widthMm: W, heightMm: H, shapes };
}
