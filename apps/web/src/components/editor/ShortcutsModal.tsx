import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ShortcutRow {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'Tools',
    rows: [
      { keys: ['V'], label: 'Select' },
      { keys: ['H'], label: 'Pan (hand)' },
      { keys: ['W'], label: 'Wall' },
      { keys: ['R'], label: 'Room' },
      { keys: ['D'], label: 'Door' },
      { keys: ['N'], label: 'Window' },
      { keys: ['S'], label: 'Stairs' },
      { keys: ['F'], label: 'Furniture' },
      { keys: ['M'], label: 'Measure' },
      { keys: ['T'], label: 'Text label' },
    ],
  },
  {
    title: 'Drawing',
    rows: [
      { keys: ['Shift'], label: 'Straight / 45° walls while drawing' },
      { keys: ['X'], label: 'Flip internal/external thickness (Wall tool)' },
      { keys: ['↑↓←→', '1', '2', '…', 'Enter'], label: 'Type an exact wall length mid-chain' },
      { keys: ['Enter'], label: 'Finish a clicked-out room shape' },
      { keys: ['Backspace'], label: 'Remove the last room-shape corner' },
      { keys: ['Esc'], label: 'Cancel the current draft / deselect' },
    ],
  },
  {
    title: 'Editing',
    rows: [
      { keys: ['Delete'], label: 'Delete selection' },
      { keys: ['↑↓←→'], label: 'Nudge selection' },
      { keys: ['Shift', 'Click'], label: 'Add/remove from selection' },
      { keys: ['Double-click'], label: 'Rename a room' },
      { keys: ['Right-click'], label: 'Quick actions menu' },
      { keys: ['Ctrl', 'Z'], label: 'Undo — add Shift to redo' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: ['Space', 'Drag'], label: 'Pan the canvas' },
      { keys: ['+', '−'], label: 'Zoom in / out' },
      { keys: ['0'], label: 'Fit plan to screen' },
      { keys: ['?'], label: 'This cheat sheet' },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded-md border border-line bg-shell px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-ink-mid">
      {children}
    </kbd>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  // Escape-to-close via a ref: with [onClose] deps, any parent re-render
  // during the SAME keydown dispatch (e.g. the canvas's own Escape handler
  // deselecting) tears the listener down and re-adds it mid-dispatch — and a
  // listener re-added during dispatch never receives the in-flight event.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,30,26,0.44)] p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-[680px] max-w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-toast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Keyboard shortcuts</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">Press ? anywhere in the editor to open this.</p>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-shell"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="text-[11px] font-semibold tracking-[0.07em] text-ink-ghost">
                {g.title.toUpperCase()}
              </div>
              <div className="mt-2 space-y-1.5">
                {g.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px] text-ink-mid">{row.label}</span>
                    <span className="flex flex-none items-center gap-1">
                      {row.keys.map((k, i) => (
                        <Key key={i}>{k}</Key>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
