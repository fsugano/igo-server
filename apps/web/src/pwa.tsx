import { useEffect, useState } from 'react';

/** Set when the person accepts the update: only then does a change of worker reload the page (not on first install). */
let accepted = false;

/**
 * Registers the service worker (built app only) and offers to reload when a new version is ready.
 * The new version waits until the person accepts, so a game is never interrupted by a reload.
 */
export function UpdateNotice() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };
    navigator.serviceWorker.register('/sw.js').then((r) => {
      reg = r;
      watch(r);
    }, () => {});
    // Look for a new version when the app comes back to the front.
    const onVisible = () => document.visibilityState === 'visible' && void reg?.update().catch(() => {});
    document.addEventListener('visibilitychange', onVisible);
    const onController = () => {
      if (!accepted) return;
      accepted = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div className="toast update-toast" role="status">
      <span>新しい版があります</span>
      <button className="primary" onClick={() => {
          accepted = true;
          waiting.postMessage('skipWaiting');
        }}>
        再読み込み
      </button>
    </div>
  );
}
