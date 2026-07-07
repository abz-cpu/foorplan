import type { Shape } from '@floorplan/core';

const FONTS = {
  sans: "'Instrument Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Rasterize a shape list (paper-mm coordinates) onto a canvas at `pxPerMm`. */
export function drawShapesToCanvas(
  canvas: HTMLCanvasElement,
  shapes: Shape[],
  widthMm: number,
  heightMm: number,
  pxPerMm: number,
): void {
  canvas.width = Math.round(widthMm * pxPerMm);
  canvas.height = Math.round(heightMm * pxPerMm);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(pxPerMm, pxPerMm);

  for (const s of shapes) {
    switch (s.kind) {
      case 'line':
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width;
        ctx.lineCap = s.cap ?? 'butt';
        ctx.setLineDash(s.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'rect':
        if (s.fill) {
          ctx.fillStyle = s.fill;
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        if (s.stroke) {
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = s.strokeWidth ?? 1;
          ctx.strokeRect(s.x, s.y, s.w, s.h);
        }
        break;
      case 'arc':
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.r, rad(s.startDeg), rad(s.endDeg), s.anticlockwise);
        ctx.stroke();
        break;
      case 'polyline':
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        break;
      case 'text': {
        ctx.fillStyle = s.color;
        ctx.font = `${s.weight ?? 400} ${s.size}px ${FONTS[s.font]}`;
        ctx.textAlign = s.align ?? 'left';
        ctx.textBaseline = 'alphabetic';
        if (s.rotateDeg) {
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(rad(s.rotateDeg));
          ctx.fillText(s.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(s.text, s.x, s.y);
        }
        break;
      }
    }
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality,
    );
  });
}
