import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Clock, CopyMinus, CornerDownRight, Maximize2, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Stat, type StatProps } from '@/components/ui/stat';
import type { ServiceRow } from './api';
import { formatDuration, matchesFilter, recentIndices, rowMatches, type BatchState, type ResultFilter, type RowStatus } from './batchState';
import { Modal, rule } from './Modal';

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

const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'created', label: 'Created' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'failed', label: 'Failed' },
];

/** Rows shown inline; the rest is one click away in the results popup. */
const INLINE_ROWS = 5;

interface RunControls {
  onStop: () => void;
  onRunAgain: () => void;
  canRunAgain: boolean;
}

interface Props extends RunControls {
  rows: ServiceRow[];
  batch: BatchState;
}

/** The stats strip and the run's main action, shared by the inline view and the popup. */
function StatsStrip({ rows, batch, onStop, onRunAgain, canRunAgain, extra }: Props & { extra?: React.ReactNode }) {
  // Tick while running so Duration counts up live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!batch.running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [batch.running]);

  const st = batch.statuses;
  const count = (f: (s: RowStatus) => boolean) => st.filter(f).length;
  const finished = count((s) => s !== 'pending' && s !== 'running');
  const created = count((s) => s === 'done');
  const filled = count((s) => s === 'filled');
  const unconfirmed = count((s) => s === 'unconfirmed');
  const duplicates = count((s) => s === 'duplicate');
  const failed = count((s) => s === 'rejected' || s === 'error');
  const elapsed = batch.startedAt ? (batch.finishedAt ?? now) - batch.startedAt : 0;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 8, padding: 10, borderBottom: rule }}>
        <RunStat label="Rows" value={`${finished} / ${rows.length}`} />
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
          {extra}
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
      <div className="bg-bg-2" style={{ height: 2, overflow: 'hidden', flexShrink: 0 }}>
        {batch.running && (
          <div
            style={{
              height: '100%',
              width: `${rows.length ? Math.min(100, (finished / rows.length) * 100) : 0}%`,
              background: 'var(--acc, #4f7cff)',
              transition: 'width 200ms',
            }}
          />
        )}
      </div>
    </>
  );
}

function ResultRow({ row: r, index: i, batch }: { row: ServiceRow; index: number; batch: BatchState }) {
  const status = batch.statuses[i] ?? 'pending';
  const meta = RESULT[status];
  const note = batch.notes[i];
  const ms = batch.rowMs[i];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 12 }}>
        <span style={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <StatusIcon status={status} />
        </span>
        <span className="text-fg-mute" style={{ width: 36, flexShrink: 0 }}>
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
          style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, padding: '0 12px 8px 74px', fontSize: 11 }}
        >
          <CornerDownRight style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
          {note}
        </p>
      )}
    </div>
  );
}

/** Inline: the stats, the progress, and the few most recent rows — the full list is
 *  in a popup, since a file can have hundreds of rows. */
export function RunResults(props: Props) {
  const [open, setOpen] = useState(false);
  const { rows, batch } = props;
  const visible = recentIndices(batch.statuses, INLINE_ROWS);
  const more = rows.length > visible.length;

  return (
    <>
      <div style={{ border: rule, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <StatsStrip
          {...props}
          extra={
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} title="All rows, with filters and search">
              <Maximize2 style={{ width: 13, height: 13 }} /> View all {rows.length}
            </Button>
          }
        />
        <div className="divide-y">
          {visible.map((i) => (
            <ResultRow key={i} row={rows[i]} index={i} batch={batch} />
          ))}
        </div>
        {more && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-fg-mute"
            style={{ borderTop: rule, background: 'transparent', border: 'none', borderTopStyle: 'solid', padding: '8px 12px', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
          >
            Showing {visible.length} of {rows.length} — view all results…
          </button>
        )}
      </div>
      {open && <ResultsDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every row, with the runner's filters plus a search over code, merchant and message. */
function ResultsDialog(props: Props & { onClose: () => void }) {
  const { rows, batch, onClose } = props;
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i }))
        .filter(({ r, i }) => matchesFilter(batch.statuses[i] ?? 'pending', filter))
        .filter(({ r, i }) => rowMatches(query, r.serviceCode, r.merchantName, batch.notes[i])),
    [rows, batch, filter, query],
  );
  const countFor = (f: ResultFilter) => batch.statuses.filter((s) => matchesFilter(s, f)).length;

  return (
    <Modal
      title="Run results"
      subtitle={`${batch.dryRun ? 'Dry run — nothing was submitted' : 'Real run'} · ${rows.length} row${rows.length === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      <div style={{ flexShrink: 0 }}>
        <StatsStrip {...props} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderBottom: rule, flexShrink: 0, flexWrap: 'wrap' }}>
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
            {f.label} <span style={{ opacity: 0.6 }}>{countFor(f.id)}</span>
          </button>
        ))}
        <Input
          style={{ marginLeft: 'auto', width: 260, height: 28, fontSize: 12 }}
          placeholder="Search code, merchant or message"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-fg-mute" style={{ fontSize: 11 }}>
          {shown.length} of {rows.length}
        </span>
      </div>
      <div className="divide-y" style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {shown.map(({ r, i }) => (
          <ResultRow key={i} row={r} index={i} batch={batch} />
        ))}
        {shown.length === 0 && (
          <p className="text-fg-mute" style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, margin: 0 }}>
            Nothing matches.
          </p>
        )}
      </div>
    </Modal>
  );
}
