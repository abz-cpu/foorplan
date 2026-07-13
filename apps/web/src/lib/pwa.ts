import { registerSW } from 'virtual:pwa-register';

/**
 * Register the service worker and keep the running tab current.
 *
 * With `registerType: 'autoUpdate'`, a freshly deployed build's service worker
 * takes control and the page reloads on its own — but only once the browser
 * actually notices the new worker, which for a long-lived tab can otherwise be
 * hours (the precache pins the old bundle in the meantime). We poll for a new
 * worker every minute and whenever the tab regains focus, so a deploy reaches
 * open sessions within about a minute instead of needing a manual hard-reload.
 */
export function setupPwaAutoUpdate(): void {
  if (typeof window === 'undefined' || import.meta.env.DEV) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        registration.update().catch(() => {
          /* offline / transient — the next tick retries */
        });
      };
      setInterval(check, 60_000);
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
