import { useEffect, type ReactNode } from 'react';

// A plugin ships no CSS of its own, so the popup is inline styles plus the host's
// colour variables: a class the host never compiled would silently do nothing.
const scrim = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
} as const;

export const rule = '1px solid var(--line, rgba(128,128,128,0.25))';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/** Large centred popup: header, scrolling body, optional footer. Escape or a click
 *  on the backdrop closes it. */
export function Modal({ title, subtitle, onClose, footer, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: 'var(--card, #fff)',
          color: 'var(--fg, #111)',
          border: rule,
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          width: 'min(1200px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: rule, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 15 }}>{title}</strong>
            {subtitle && <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-fg-mute"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>
        <div style={{ overflow: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
        {footer && (
          <div style={{ padding: '12px 18px', borderTop: rule, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
