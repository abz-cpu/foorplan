import { degrees, LineCapStyle, PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { Shape } from '@floorplan/core';

const PT_PER_MM = 72 / 25.4;

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

const CAPS: Record<string, LineCapStyle> = {
  butt: LineCapStyle.Butt,
  square: LineCapStyle.Projecting,
  round: LineCapStyle.Round,
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Render a shape list (paper-mm coordinates) to a vector PDF. */
export async function shapesToPdfBytes(
  shapes: Shape[],
  widthMm: number,
  heightMm: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([widthMm * PT_PER_MM, heightMm * PT_PER_MM]);
  const H = heightMm * PT_PER_MM;
  const X = (mm: number) => mm * PT_PER_MM;
  const Y = (mm: number) => H - mm * PT_PER_MM; // PDF y-axis points up

  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const pickFont = (s: Extract<Shape, { kind: 'text' }>): PDFFont =>
    s.font === 'mono' ? mono : (s.weight ?? 400) >= 600 ? sansBold : sans;

  for (const s of shapes) {
    switch (s.kind) {
      case 'line':
        page.drawLine({
          start: { x: X(s.x1), y: Y(s.y1) },
          end: { x: X(s.x2), y: Y(s.y2) },
          thickness: s.width * PT_PER_MM,
          color: hexToRgb(s.stroke),
          lineCap: CAPS[s.cap ?? 'butt'],
          ...(s.dash ? { dashArray: s.dash.map((d) => d * PT_PER_MM) } : {}),
        });
        break;
      case 'rect':
        page.drawRectangle({
          x: X(s.x),
          y: Y(s.y) - s.h * PT_PER_MM,
          width: s.w * PT_PER_MM,
          height: s.h * PT_PER_MM,
          ...(s.fill ? { color: hexToRgb(s.fill) } : {}),
          ...(s.stroke
            ? { borderColor: hexToRgb(s.stroke), borderWidth: (s.strokeWidth ?? 1) * PT_PER_MM }
            : {}),
        });
        break;
      case 'arc': {
        // SVG-style path in pt, y-down, origin placed at the page's top-left.
        const sx = (s.cx + s.r * Math.cos(rad(s.startDeg))) * PT_PER_MM;
        const sy = (s.cy + s.r * Math.sin(rad(s.startDeg))) * PT_PER_MM;
        const ex = (s.cx + s.r * Math.cos(rad(s.endDeg))) * PT_PER_MM;
        const ey = (s.cy + s.r * Math.sin(rad(s.endDeg))) * PT_PER_MM;
        const r = s.r * PT_PER_MM;
        const sweep = s.anticlockwise ? 0 : 1;
        page.drawSvgPath(`M ${sx} ${sy} A ${r} ${r} 0 0 ${sweep} ${ex} ${ey}`, {
          x: 0,
          y: H,
          borderColor: hexToRgb(s.stroke),
          borderWidth: s.width * PT_PER_MM,
        });
        break;
      }
      case 'polyline': {
        const d = s.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * PT_PER_MM} ${p.y * PT_PER_MM}`)
          .join(' ');
        page.drawSvgPath(d, {
          x: 0,
          y: H,
          borderColor: hexToRgb(s.stroke),
          borderWidth: s.width * PT_PER_MM,
        });
        break;
      }
      case 'text': {
        const font = pickFont(s);
        const size = s.size * PT_PER_MM;
        const width = font.widthOfTextAtSize(s.text, size);
        if (s.rotateDeg === -90) {
          // Vertical label reading bottom-to-top, centred on (x, y).
          page.drawText(s.text, {
            x: X(s.x),
            y: Y(s.y) - width / 2,
            size,
            font,
            color: hexToRgb(s.color),
            rotate: degrees(90),
          });
        } else {
          const dx = s.align === 'center' ? width / 2 : s.align === 'right' ? width : 0;
          page.drawText(s.text, {
            x: X(s.x) - dx,
            y: Y(s.y),
            size,
            font,
            color: hexToRgb(s.color),
          });
        }
        break;
      }
    }
  }
  return pdf.save();
}
