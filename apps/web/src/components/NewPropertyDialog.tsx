import { useEffect, useRef, useState } from 'react';
import { Button, TextInput } from '@floorplan/ui';

export interface NewPropertyValues {
  addressLine1: string;
  addressLine2: string;
  postcode: string;
}

export function NewPropertyDialog({
  onCreate,
  onClose,
}: {
  onCreate: (values: NewPropertyValues) => void;
  onClose: () => void;
}) {
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [postcode, setPostcode] = useState('');
  const valid = addressLine1.trim().length > 0;

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

  const submit = () => {
    if (!valid) return;
    onCreate({
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim(),
      postcode: postcode.trim().toUpperCase(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div
        className="w-[420px] max-w-full rounded-2xl bg-white p-6 shadow-toast"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight">New Property</h2>
        <p className="mt-1 text-[13px] text-ink-faint">
          The plan opens in the editor as soon as it's created.
        </p>

        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Address line 1</label>
            <TextInput
              autoFocus
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="14 Wolseley Road"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-mid">
              Address line 2 <span className="font-normal text-ink-ghost">(optional)</span>
            </label>
            <TextInput
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Plumstead, London"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-mid">
              Postcode <span className="font-normal text-ink-ghost">(optional)</span>
            </label>
            <TextInput
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="SE18 3EY"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2.5">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} className="shadow-cta">
              Create property
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
