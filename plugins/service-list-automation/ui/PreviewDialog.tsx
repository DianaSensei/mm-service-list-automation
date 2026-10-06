import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import type { ParsedCsv } from './api';
import type { Settings } from './settings';
import { buildChecklist, buildPreview, PREVIEW_COLUMNS } from './verify';

export interface PreviewAction {
  label: string;
  /** A real run: shown in the danger style with a warning line. */
  real: boolean;
  onRun: () => void;
}

interface Props {
  parsed: ParsedCsv;
  fileName: string | null;
  settings: Settings;
  onClose: () => void;
  /** Present when the popup was opened by Start: the run begins from here. */
  action?: PreviewAction;
}

// Built from inline styles and the host's colour variables only: a plugin ships no
// CSS, and a class the host never compiled would silently do nothing.
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
const panel = {
  background: 'var(--card, #fff)',
  color: 'var(--fg, #111)',
  border: '1px solid var(--line, rgba(128,128,128,0.3))',
  borderRadius: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
  width: 'min(1200px, 100%)',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
} as const;
const cell = { padding: '4px 8px', textAlign: 'left', verticalAlign: 'top', whiteSpace: 'nowrap' } as const;
const rule = '1px solid var(--line, rgba(128,128,128,0.25))';

/** "Here is exactly what will be entered": the column mapping and every row,
 *  field by field, as it will go into the form. */
export function PreviewDialog({ parsed, fileName, settings, onClose, action }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const skipDup = settings.outcome.skipFileDuplicates;
  const rows = buildPreview(parsed.rows, settings, skipDup);
  const { items, unused } = buildChecklist(parsed.mapping, parsed.header, parsed.rows, settings);
  const fromCsv = items.filter((i) => i.kind === 'csv');
  const warned = items.filter((i) => i.warning);
  const dupCount = rows.filter((r) => r.duplicateOf).length;
  const toRun = rows.length - dupCount;

  return (
    <div style={scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel} role="dialog" aria-modal="true" aria-label="Preview">
        <div style={{ padding: '14px 18px', borderBottom: rule }}>
          <strong style={{ fontSize: 15 }}>Preview — data that will be entered</strong>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
            {fileName ?? 'CSV'}: {rows.length} row{rows.length === 1 ? '' : 's'}
            {dupCount ? `, ${dupCount} repeated service code${dupCount === 1 ? '' : 's'} will be skipped` : ''}.
            Accounting Code and Department name are not touched.
          </div>
        </div>

        <div style={{ padding: '12px 18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {warned.length > 0 && (
            <Callout tone="warning">
              {warned.map((i) => i.label).join(', ')}: not found by header name — the configured column is used.
            </Callout>
          )}

          <div style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {fromCsv.map((i) => (
              <span key={i.label}>
                <strong>{i.label}</strong> ← {i.source.replace(/^column /, 'col ')}
              </span>
            ))}
            {unused.length > 0 && (
              <span style={{ opacity: 0.7 }}>Ignored: {unused.map((u) => `col ${u.column} “${u.header}”`).join(', ')}</span>
            )}
          </div>

          <div style={{ overflow: 'auto', border: rule, borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--sunk, rgba(128,128,128,0.08))' }}>
                  <th style={cell}>#</th>
                  {PREVIEW_COLUMNS.map((c) => (
                    <th key={c} style={cell}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n} style={{ borderTop: rule, opacity: r.duplicateOf ? 0.5 : 1 }}>
                    <td style={cell} title={r.duplicateOf ? `Same service code as row ${r.duplicateOf}: skipped` : undefined}>
                      {r.n}
                      {r.duplicateOf ? ` (= ${r.duplicateOf}, skipped)` : ''}
                    </td>
                    {PREVIEW_COLUMNS.map((c) => (
                      <td key={c} style={cell}>
                        {r.values[c] === '' ? <em style={{ opacity: 0.6 }}>(empty)</em> : r.values[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: rule, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {action?.real && (
            <span style={{ fontSize: 12, flex: 1 }}>
              This is a real run: {toRun} service code{toRun === 1 ? '' : 's'} will be created in the system.
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={onClose}>
              {action ? 'Cancel' : 'Close'}
            </Button>
            {action && (
              <Button variant={action.real ? 'destructive' : 'default'} disabled={toRun === 0} onClick={action.onRun}>
                {action.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
