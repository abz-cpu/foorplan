import type { Shape } from '@floorplan/core';

const FONTS = {
  sans: "'Instrument Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rad = (deg: number) => (deg * Math.PI) / 180;
const n = (v: number) => +v.toFixed(3);

/** Render a shape list (paper-mm coordinates) to a standalone SVG string. */
export function shapesToSvg(shapes: Shape[], widthMm: number, heightMm: number): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}" width="${widthMm}mm" height="${heightMm}mm">`,
    `<rect x="0" y="0" width="${widthMm}" height="${heightMm}" fill="#FFFFFF"/>`,
  ];

  for (const s of shapes) {
    switch (s.kind) {
      case 'line': {
        const dash = s.dash ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : '';
        parts.push(
          `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linecap="${s.cap ?? 'butt'}"${dash}/>`,
        );
        break;
      }
      case 'rect': {
        const fill = s.fill ? ` fill="${s.fill}"` : ' fill="none"';
        const stroke = s.stroke
          ? ` stroke="${s.stroke}" stroke-width="${n(s.strokeWidth ?? 1)}"`
          : '';
        parts.push(
          `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${fill}${stroke}/>`,
        );
        break;
      }
      case 'arc': {
        const sx = s.cx + s.r * Math.cos(rad(s.startDeg));
        const sy = s.cy + s.r * Math.sin(rad(s.startDeg));
        const ex = s.cx + s.r * Math.cos(rad(s.endDeg));
        const ey = s.cy + s.r * Math.sin(rad(s.endDeg));
        const sweep = s.anticlockwise ? 0 : 1;
        parts.push(
          `<path d="M ${n(sx)} ${n(sy)} A ${n(s.r)} ${n(s.r)} 0 0 ${sweep} ${n(ex)} ${n(ey)}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.width)}"/>`,
        );
        break;
      }
      case 'polyline': {
        const pts = s.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
        parts.push(
          `<polyline points="${pts}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linejoin="round"/>`,
        );
        break;
      }
      case 'text': {
        const anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start';
        const rotate = s.rotateDeg ? ` transform="rotate(${s.rotateDeg} ${n(s.x)} ${n(s.y)})"` : '';
        parts.push(
          `<text x="${n(s.x)}" y="${n(s.y)}" font-family="${FONTS[s.font]}" font-size="${n(s.size)}" font-weight="${s.weight ?? 400}" fill="${s.color}" text-anchor="${anchor}"${rotate}>${escXml(s.text)}</text>`,
        );
        break;
      }
      case 'image': {
        parts.push(
          `<image x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" href="${escXml(s.href)}" preserveAspectRatio="xMidYMid meet"/>`,
        );
        break;
      }
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
