/** "4400" (mm) → "4.40 m" */
export function formatMmAsM(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/** Area in m² → "84.0 m²" */
export function formatAreaM2(areaM2: number, decimals = 1): string {
  return `${areaM2.toFixed(decimals)} m²`;
}

/** How floor areas are displayed throughout the app. UK listings (Rightmove,
 *  EPC reports) conventionally quote square feet alongside square metres. */
export type AreaUnits = 'm2' | 'ft2' | 'both';

const SQFT_PER_M2 = 10.7639;

/** "153 ft²" — whole square feet; sub-foot precision is meaningless. */
export function formatAreaSqFt(areaM2: number): string {
  return `${Math.round(areaM2 * SQFT_PER_M2)} ft²`;
}

/** Format an area in the chosen display units ("14.2 m²", "153 ft²", or
 *  "14.2 m² · 153 ft²"). */
export function formatArea(areaM2: number, units: AreaUnits = 'm2', decimals = 1): string {
  if (units === 'ft2') return formatAreaSqFt(areaM2);
  if (units === 'both') return `${formatAreaM2(areaM2, decimals)} · ${formatAreaSqFt(areaM2)}`;
  return formatAreaM2(areaM2, decimals);
}

/** "4.40 × 3.40 m" */
export function formatDims(wMm: number, hMm: number): string {
  return `${(wMm / 1000).toFixed(2)} × ${(hMm / 1000).toFixed(2)} m`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
