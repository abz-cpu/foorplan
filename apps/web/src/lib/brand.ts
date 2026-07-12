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

/** Read a logo file → data URL + aspect ratio, downscaled to keep exports lean. */
export function readLogoFile(file: File): Promise<{ dataUrl: string; aspect: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        const maxW = 600; // logos never need more on an A3 header
        const scale = img.width > maxW ? maxW / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fall back to the original data URL if canvas is unavailable.
          resolve({ dataUrl: src, aspect: img.width / img.height });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        // PNG preserves logo transparency; JPEG would flatten it onto black.
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspect: w / h });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
