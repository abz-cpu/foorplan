export function Toggle({
  checked,
  onChange,
  label,
  title,
  dark = false,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
  title?: string;
  /** Set on dark backgrounds so the "off" track stays visible. */
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={onChange}
      className="flex cursor-pointer items-center gap-2"
    >
      {label && <span className="text-[13px] font-medium">{label}</span>}
      <span
        className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
          checked ? 'bg-action' : dark ? 'bg-white/20' : 'bg-ink/15'
        }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[16px]' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
