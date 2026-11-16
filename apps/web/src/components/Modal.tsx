import { ReactNode, useEffect } from 'react';

/** A dialog over the page. Escape or a click outside closes it when onClose is given. */
export function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="link close" onClick={onClose} aria-label="閉じる">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
