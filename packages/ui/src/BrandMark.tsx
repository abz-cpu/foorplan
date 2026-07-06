import { colors } from './tokens';

/** The L&D Energy plan-glyph logo from the design drafts. */
export function BrandMark({ size = 32 }: { size?: number }) {
  const icon = Math.round(size * 0.53);
  return (
    <div
      className="flex flex-none items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.28, background: colors.brand }}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.brandInk}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 4h16v16H4z" />
        <path d="M12 4v8" />
        <path d="M12 12h8" />
        <path d="M4 15h5" />
      </svg>
    </div>
  );
}
