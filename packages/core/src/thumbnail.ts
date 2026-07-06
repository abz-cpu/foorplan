import { docBounds } from './geometry';
import type { FloorDoc } from './types';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  padding?: number;
  stroke?: string;
  roomFill?: string;
}

/**
 * Render a floor document to a small standalone SVG string — used for
 * dashboard property-card thumbnails, matching the design's mini plans.
 */
export function docToThumbnailSvg(doc: FloorDoc, options: ThumbnailOptions = {}): string {
  const {
    width = 180,
    height = 116,
    padding = 12,
    stroke = '#2B463F',
    roomFill = '#FFFFFF',
  } = options;

  const bounds = docBounds(doc);
  const header = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none">`;
  if (!bounds || (bounds.maxX === bounds.minX && bounds.maxY === bounds.minY)) {
    return `${header}</svg>`;
  }

  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const tx = (x: number) => +((x - bounds.minX) * scale + offsetX).toFixed(2);
  const ty = (y: number) => +((y - bounds.minY) * scale + offsetY).toFixed(2);

  const parts: string[] = [header];
  for (const r of doc.rooms) {
    parts.push(
      `<rect x="${tx(r.x)}" y="${ty(r.y)}" width="${+(r.w * scale).toFixed(2)}" height="${+(
        r.h * scale
      ).toFixed(2)}" fill="${roomFill}" stroke="${stroke}" stroke-width="1.5"/>`,
    );
  }
  for (const w of doc.walls) {
    parts.push(
      `<line x1="${tx(w.a.x)}" y1="${ty(w.a.y)}" x2="${tx(w.b.x)}" y2="${ty(w.b.y)}" stroke="${stroke}" stroke-width="3" stroke-linecap="square"/>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}
