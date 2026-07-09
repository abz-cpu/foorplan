import { useEffect, useState } from 'react';

/** Matches Tailwind's `md` breakpoint: true below 768px. Kept as a JS hook
 *  (not just CSS classes) for the places where mobile needs genuinely
 *  different component trees — e.g. the properties panel renders as a
 *  right sidebar on desktop but a bottom sheet on phones. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}
