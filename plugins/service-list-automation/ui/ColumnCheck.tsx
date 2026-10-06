import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import type { ParsedCsv } from './api';
import type { Settings } from './settings';
import { buildChecklist } from './verify';

interface Props {
  parsed: ParsedCsv;
  settings: Settings;
  confirmed: boolean;
  onConfirm: () => void;
  disabled?: boolean;
}

const cell = { padding: '4px 8px', verticalAlign: 'top', textAlign: 'left' } as const;
const KIND_NOTE = { csv: '', fixed: '', derived: '', untouched: 'not set by the tool' } as const;

/** The "is this what the form needs?" table: for each field on the page, which CSV
 *  column feeds it and what the first rows would put there. Nothing real can start
 *  until the user has confirmed it. */
export function ColumnCheck({ parsed, settings, confirmed, onConfirm, disabled }: Props) {
  const { items, unused } = buildChecklist(parsed.mapping, parsed.header, parsed.rows, settings);
  const warned = items.filter((i) => i.warning);
  const sampleCount = Math.min(2, parsed.rows.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        Check each line against the form. “Filled from” is where the tool reads the value; the sample columns show what
        the first {sampleCount === 1 ? 'row' : `${sampleCount} rows`} would enter.
      </div>

      {warned.length > 0 && (
        <Callout tone="warning">
          {warned.map((i) => i.label).join(', ')}: the header has no column with that name, so the configured column
          number is used. Make sure it is the right one.
        </Callout>
      )}

      <div style={{ overflowX: 'auto', fontSize: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ opacity: 0.7 }}>
              <th style={cell}>Form field</th>
              <th style={cell}>Filled from</th>
              {Array.from({ length: sampleCount }, (_, i) => (
                <th key={i} style={cell}>
                  Row {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.label} style={{ borderTop: '1px solid rgba(128,128,128,0.25)', opacity: i.kind === 'untouched' ? 0.6 : 1 }}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{i.label}</td>
                <td style={cell}>
                  {i.kind === 'csv' ? i.source : KIND_NOTE[i.kind] || i.source}
                  {i.warning && <strong> ⚠</strong>}
                </td>
                {i.samples.map((v, k) => (
                  <td key={k} style={cell}>
                    {v === '' ? <em style={{ opacity: 0.6 }}>(empty)</em> : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unused.length > 0 && (
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Not used by the form (ignored):{' '}
          {unused.map((u) => `column ${u.column} “${u.header}”`).join('; ')}.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={onConfirm} disabled={disabled || confirmed}>
          {confirmed ? 'Mapping confirmed ✓' : 'This matches the form — confirm'}
        </Button>
        {!confirmed && (
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            A real run needs this. A dry run (nothing submitted) does not.
          </span>
        )}
      </div>
    </div>
  );
}
