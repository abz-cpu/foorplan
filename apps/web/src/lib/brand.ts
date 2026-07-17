import type { BrandProfile } from '@floorplan/export';

/**
 * A reusable company brand profile (logo, name, disclaimer) for exported
 * plans — a per-device setting, like the export defaults, stored in
 * localStorage rather than in any one property's document so it applies to
 * every plan the assessor produces.
 */
const BRAND_KEY = 'floorplan:brandProfile';

export function loadBrandProfile(): BrandProfile {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BrandProfile;
    return {
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName : undefined,
      logoDataUrl: typeof parsed.logoDataUrl === 'string' ? parsed.logoDataUrl : undefined,
      logoAspect: typeof parsed.logoAspect === 'number' ? parsed.logoAspect : undefined,
      disclaimerText: typeof parsed.disclaimerText === 'string' ? parsed.disclaimerText : undefined,
    };
  } catch {
    return {};
  }
}

export function saveBrandProfile(profile: BrandProfile): void {
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable (private mode / quota) — branding just won't persist */
  }
}

/**
 * Bounding box of the "inked" pixels — anything not transparent and not
 * near-white. Lets us crop the empty margin a logo PNG is usually saved
 * with, so it fills its box on the sheet instead of floating tiny in white.
 */
function contentBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const nearWhite = data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244;
      if (a > 16 && !nearWhite) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Read a logo file → data URL + aspect ratio, with the surrounding blank
 *  margin trimmed and downscaled to keep exports lean. */
export function readLogoFile(file: File): Promise<{ dataUrl: string; aspect: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        // 1) Draw at natural size to inspect pixels and find the inked box.
        const full = document.createElement('canvas');
        full.width = Math.max(1, img.width);
        full.height = Math.max(1, img.height);
        const fctx = full.getContext('2d');
        if (!fctx) {
          resolve({ dataUrl: src, aspect: img.width / img.height });
          return;
        }
        fctx.drawImage(img, 0, 0);
        let crop = { x: 0, y: 0, w: full.width, h: full.height };
        try {
          const px = fctx.getImageData(0, 0, full.width, full.height).data;
          const b = contentBounds(px, full.width, full.height);
          if (b && b.w >= 4 && b.h >= 4) {
            // A hair of padding so glyph edges aren't clipped.
            const pad = Math.round(Math.max(b.w, b.h) * 0.02);
            crop = {
              x: Math.max(0, b.x - pad),
              y: Math.max(0, b.y - pad),
              w: Math.min(full.width, b.w + pad * 2),
              h: Math.min(full.height, b.h + pad * 2),
            };
          }
        } catch {
          /* tainted canvas shouldn't happen for a data URL — fall through */
        }
        // 2) Emit the cropped region, downscaled to a sane width.
        const maxW = 600; // logos never need more on an A3 header
        const scale = crop.w > maxW ? maxW / crop.w : 1;
        const w = Math.max(1, Math.round(crop.w * scale));
        const h = Math.max(1, Math.round(crop.h * scale));
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const octx = out.getContext('2d');
        if (!octx) {
          resolve({ dataUrl: src, aspect: img.width / img.height });
          return;
        }
        octx.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
        // PNG preserves logo transparency; JPEG would flatten it onto black.
        resolve({ dataUrl: out.toDataURL('image/png'), aspect: w / h });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
