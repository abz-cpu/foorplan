/**
 * Flexible length parsing for numeric-entry fields (wall length, opening
 * offsets/widths). Assessors think in whichever unit suits the job — a door
 * gap in mm, a room in metres, an older property in feet and inches — so the
 * same free-text field accepts all of them and normalises to millimetres.
 *
 * Recognised forms (case-insensitive, surrounding whitespace ignored):
 *   "4.2"        bare number, assumed metres -> 4200mm
 *   "4200mm" / "4200 mm"
 *   "420cm" / "420 cm"
 *   "4.2m" / "4.2 m"
 *   "13'9\"" / "13' 9\"" / "13ft 9in" / "13ft"  -> feet/inches
 */
export function parseLengthToMm(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const feetInches = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)(?:\s*(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (feetInches) {
    const feet = Number.parseFloat(feetInches[1]);
    const inches = feetInches[2] ? Number.parseFloat(feetInches[2]) : 0;
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    return (feet * 12 + inches) * 25.4;
  }

  const unitMatch = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (unitMatch) {
    const value = Number.parseFloat(unitMatch[1]);
    if (!Number.isFinite(value)) return null;
    const unit = unitMatch[2] ?? 'm';
    if (unit === 'mm') return value;
    if (unit === 'cm') return value * 10;
    return value * 1000;
  }

  return null;
}

/** "4200" (mm) -> "4.20m" - compact form for input-field round-tripping. */
export function formatMmForInput(mm: number): string {
  return `${(mm / 1000).toFixed(2)}m`;
}
