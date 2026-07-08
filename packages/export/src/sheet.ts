import {
  docBounds,
  docToShapes,
  floorGiaM2,
  formatAreaM2,
  transformShapes,
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

export interface SheetOptions {
  address: string;
  floorName: string;
  paper: PaperSize;
  orientation: Orientation;
  showMeasurements: boolean;
  disclaimer: boolean;
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
  const headerH = 15;

  const shapes: Shape[] = [];

  /* Header: address + floor/GIA, brand mark right */
  shapes.push(
    { kind: 'text', x: margin, y: margin + 4.6, text: opts.address, size: 5, color: INK, font: 'sans', weight: 700, align: 'left' },
    {
      kind: 'text',
      x: margin,
      y: margin + 9.6,
      text: `${opts.floorName} · Approx. GIA ${formatAreaM2(floorGiaM2(doc))}`,
      size: 3.1,
      color: GHOST,
      font: 'sans',
      align: 'left',
    },
    { kind: 'rect', x: W - margin - 27.5, y: margin + 0.6, w: 4.2, h: 4.2, fill: BRAND },
    {
      kind: 'text',
      x: W - margin,
      y: margin + 4,
      text: 'L&D ENERGY',
      size: 2.9,
      color: '#33433E',
      font: 'sans',
      weight: 700,
      align: 'right',
    },
    { kind: 'line', x1: margin, y1: margin + headerH - 2.5, x2: W - margin, y2: margin + headerH - 2.5, stroke: RULE, width: 0.4 },
  );

  /* Footer disclaimer */
  let footerH = 0;
  if (opts.disclaimer) {
    const size = 2.2;
    const lines = wrapText(DISCLAIMER_TEXT, Math.floor((W - margin * 2) / (size * 0.5)));
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
    const planShapes = docToShapes(doc, { showDims: opts.showMeasurements, showLabels: true });
    shapes.push(...transformShapes(planShapes, scale, dx, dy));

    /* Scale bar (bottom-left of content box) */
    if (opts.showMeasurements) {
      const niceWorldMm = [1000, 2000, 5000].reverse().find((l) => l * scale <= cw / 3) ?? 1000;
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
          text: `${niceWorldMm / 1000} m`,
          size: 2.6,
          color: '#4A5D57',
          font: 'mono',
          align: 'center',
        },
      );
    }

    /* North arrow (top-right of content box), rotated to the plan's stored
       north direction — 0deg (default) points straight up the page. */
    const nx = cx0 + cw - 6;
    const ny = cy0 + 8;
    const center: Point = { x: nx, y: ny };
    const northDeg = doc.northAngleDeg ?? 0;
    const arrowPts = [
      { x: nx - 1.6, y: ny + 2.2 },
      { x: nx, y: ny - 2.6 },
      { x: nx + 1.6, y: ny + 2.2 },
      { x: nx, y: ny + 1 },
      { x: nx - 1.6, y: ny + 2.2 },
    ].map((p) => rotatePoint(p, center, northDeg));
    const labelPt = rotatePoint({ x: nx, y: ny + 7.6 }, center, northDeg);
    shapes.push(
      { kind: 'arc', cx: nx, cy: ny, r: 4.4, startDeg: 0, endDeg: 359.99, anticlockwise: false, stroke: '#7C9A90', width: 0.4 },
      { kind: 'polyline', points: arrowPts, stroke: '#4A5D57', width: 0.5 },
      {
        kind: 'text',
        x: labelPt.x,
        y: labelPt.y,
        text: 'N',
        size: 2.8,
        color: '#4A5D57',
        font: 'sans',
        weight: 700,
        align: 'center',
      },
    );
  }

  return { widthMm: W, heightMm: H, shapes };
}
