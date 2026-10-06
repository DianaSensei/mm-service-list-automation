import { useEffect, useState } from 'react';
import { Check, Circle, Clock, CopyMinus, CornerDownRight, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Stat, type StatProps } from '@/components/ui/stat';
import type { ServiceRow } from './api';
import { formatDuration, matchesFilter, type BatchState, type ResultFilter, type RowStatus } from './batchState';

// Same anatomy as the API client's collection runner (RunnerDialog): a strip of
// compact stats with the run's main action on the right, a hairline progress bar,
// filter tabs, then one line per item with its outcome and timing, and the
// page's message on an indented second line.

const RunStat = (props: Omit<StatProps, 'variant'>) => <Stat variant="compact" {...props} />;

const RESULT: Record<RowStatus, { label: string; cls: string }> = {
  pending: { label: 'Waiting', cls: 'text-fg-mute' },
  running: { label: 'Running', cls: 'text-fg-mute' },
  done: { label: 'Created', cls: 'text-ok' },
  unconfirmed: { label: 'Not confirmed', cls: 'text-warn' },
  filled: { label: 'Filled', cls: 'text-info' },
  duplicate: { label: 'Duplicate', cls: 'text-fg-mute' },
  rejected: { label: 'Rejected', cls: 'text-bad' },
  error: { label: 'Failed', cls: 'text-bad' },
};

function StatusIcon({ status }: { status: RowStatus }) {
  const size = { width: 14, height: 14 };
  switch (status) {
    case 'running':
      return <Spinner size="sm" className="text-fg-mute" />;
    case 'done':
    case 'filled':
      return <Check style={size} className="text-ok" />;
    case 'unconfirmed':
      return <TriangleAlert style={size} className="text-warn" />;
    case 'duplicate':
      return <CopyMinus style={size} className="text-fg-mute" />;
    case 'rejected':
    case 'error':
      return <X style={size} className="text-bad" />;
    default:
      return <Circle style={{ width: 10, height: 10 }} className="text-fg-mute" />;
  }
}

const rule = '1px solid var(--line, rgba(128,128,128,0.25))';
const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'created', label: 'Created' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'failed', label: 'Failed' },
];

interface Props {
  rows: ServiceRow[];
  batch: BatchState;
  onStop: () => void;
  onRunAgain: () => void;
  canRunAgain: boolean;
}

export function RunResults({ rows, batch, onStop, onRunAgain, canRunAgain }: Props) {
  const [filter, setFilter] = useState<ResultFilter>('all');
  // Tick while running so the Duration stat counts up live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!batch.running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [batch.running]);

  const total = rows.length;
  const st = batch.statuses;
  const count = (f: (s: RowStatus) => boolean) => st.filter(f).length;
  const finished = count((s) => s !== 'pending' && s !== 'running');
  const created = count((s) => s === 'done');
  const filled = count((s) => s === 'filled');
  const unconfirmed = count((s) => s === 'unconfirmed');
  const duplicates = count((s) => s === 'duplicate');
  const failed = count((s) => s === 'rejected' || s === 'error');
  const elapsed = batch.startedAt ? (batch.finishedAt ?? now) - batch.startedAt : 0;
  const shown = rows.map((r, i) => ({ r, i, status: st[i] ?? 'pending' })).filter((x) => matchesFilter(x.status, filter));

  return (
    <div style={{ border: rule, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 8, padding: 10, borderBottom: rule }}>
        <RunStat label="Rows" value={`${finished} / ${total}`} />
        {batch.dryRun ? (
          <RunStat label="Filled" value={filled} tone={filled ? 'success' : 'muted'} />
        ) : (
          <RunStat label="Created" value={created} tone={created ? 'success' : 'muted'} />
        )}
        {unconfirmed > 0 && <RunStat label="Not confirmed" value={unconfirmed} tone="warning" />}
        <RunStat label="Duplicates" value={duplicates} tone="muted" />
        <RunStat label="Failed" value={failed} tone={failed ? 'danger' : 'muted'} />
        <RunStat label="Duration" value={elapsed ? formatDuration(elapsed) : '—'} icon={<Clock style={{ width: 12, height: 12 }} />} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {batch.running ? (
            <Button size="sm" variant="destructive" onClick={onStop} title="Finishes the current row, then stops">
              <Square style={{ width: 13, height: 13 }} /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onRunAgain} disabled={!canRunAgain}>
              <RotateCcw style={{ width: 13, height: 13 }} /> Run again
            </Button>
          )}
        </div>
      </div>

      {/* progress — fixed height so nothing shifts when it appears */}
      <div className="bg-bg-2" style={{ height: 2, overflow: 'hidden' }}>
        {batch.running && (
          <div
            style={{
              height: '100%',
              width: `${total ? Math.min(100, (finished / total) * 100) : 0}%`,
              background: 'var(--acc, #4f7cff)',
              transition: 'width 200ms',
            }}
          />
        )}
      </div>

      {/* filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderBottom: rule }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={filter === f.id ? 'text-fg' : 'text-fg-mute'}
            style={{
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 500,
              background: filter === f.id ? 'var(--acc-soft, rgba(128,128,128,0.18))' : 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="text-fg-mute" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {shown.length} of {total}
        </span>
      </div>

      {/* rows */}
      <div className="divide-y" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {shown.map(({ r, i, status }) => {
          const meta = RESULT[status];
          const note = batch.notes[i];
          const ms = batch.rowMs[i];
          return (
            <div key={`${r.serviceCode}-${i}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 12 }}>
                <span style={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <StatusIcon status={status} />
                </span>
                <span className="text-fg-mute" style={{ width: 28, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ width: 170, flexShrink: 0, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.serviceCode}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.merchantName}>
                  {r.merchantName}
                </span>
                <span className={meta.cls} style={{ width: 110, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>
                  {meta.label}
                </span>
                <span className="text-fg-mute" style={{ width: 64, flexShrink: 0, textAlign: 'right' }}>
                  {ms !== undefined ? formatDuration(ms) : ''}
                </span>
              </div>
              {note && (
                <p
                  className={status === 'rejected' || status === 'error' ? 'text-bad' : 'text-fg-mute'}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, padding: '0 12px 8px 66px', fontSize: 11 }}
                >
                  <CornerDownRight style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
                  {note}
                </p>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="text-fg-mute" style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, margin: 0 }}>
            Nothing matches this filter.
          </p>
        )}
      </div>
    </div>
  );
}
