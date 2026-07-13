import { degrees, LineCapStyle, PDFDocument, PDFString, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
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
  pdf.registerFontkit(fontkit);

  // Embed the real brand monospace so measurement labels match the app
  // exactly and still work fully offline (service worker caches these
  // routes). Sans-serif falls back to a PDF standard font: Instrument Sans
  // isn't distributed as a raw TTF (only woff/woff2, which fontkit can't
  // embed) without fetching from an external font host, which would make
  // PDF export depend on network access — not acceptable for an
  // offline-first export path.
  const [monoBytes, monoMediumBytes] = await Promise.all([
    fetch('/fonts/IBMPlexMono-Regular.ttf').then((res) => res.arrayBuffer()),
    fetch('/fonts/IBMPlexMono-Medium.ttf').then((res) => res.arrayBuffer()),
  ]);

  const sansRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ibmMono = await pdf.embedFont(monoBytes);
  const ibmMonoMedium = await pdf.embedFont(monoMediumBytes);

  const page = pdf.addPage([widthMm * PT_PER_MM, heightMm * PT_PER_MM]);
  const H = heightMm * PT_PER_MM;
  const X = (mm: number) => mm * PT_PER_MM;
  const Y = (mm: number) => H - mm * PT_PER_MM; // PDF y-axis points up

  const pickFont = (s: Extract<Shape, { kind: 'text' }>): PDFFont => {
    if (s.font === 'mono') {
      return (s.weight ?? 400) >= 500 ? ibmMonoMedium : ibmMono;
    }
    return (s.weight ?? 400) >= 600 ? sansBold : sansRegular;
  };

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
        const d =
          s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * PT_PER_MM} ${p.y * PT_PER_MM}`).join(' ') +
          (s.closed ? ' Z' : '');
        page.drawSvgPath(d, {
          x: 0,
          y: H,
          borderColor: hexToRgb(s.stroke),
          borderWidth: s.width * PT_PER_MM,
          ...(s.fill ? { color: hexToRgb(s.fill) } : {}),
        });
        break;
      }
      case 'image': {
        try {
          const comma = s.href.indexOf(',');
          const meta = s.href.slice(0, comma);
          const bytes = Uint8Array.from(atob(s.href.slice(comma + 1)), (c) => c.charCodeAt(0));
          const img = /jpe?g/i.test(meta) ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
          page.drawImage(img, {
            x: X(s.x),
            y: Y(s.y) - s.h * PT_PER_MM,
            width: s.w * PT_PER_MM,
            height: s.h * PT_PER_MM,
          });
        } catch {
          /* skip an unembeddable logo rather than fail the export */
        }
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
          const left = X(s.x) - dx;
          const baseline = Y(s.y);
          page.drawText(s.text, { x: left, y: baseline, size, font, color: hexToRgb(s.color) });
          if (s.href) {
            const link = pdf.context.register(
              pdf.context.obj({
                Type: 'Annot',
                Subtype: 'Link',
                Rect: [left, baseline - size * 0.25, left + width, baseline + size * 0.9],
                Border: [0, 0, 0],
                A: { Type: 'Action', S: 'URI', URI: PDFString.of(s.href) },
              }),
            );
            page.node.addAnnot(link);
          }
        }
        break;
      }
    }
  }
  return pdf.save();
}
