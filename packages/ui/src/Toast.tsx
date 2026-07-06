import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-[11px] bg-ink px-4 py-2.5 text-[13px] font-medium text-white shadow-toast">
          <Check size={15} className="text-[#5FD3AE]" strokeWidth={2.5} />
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
