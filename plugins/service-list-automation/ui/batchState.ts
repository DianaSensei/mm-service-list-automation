import type { BatchEvent } from './api';

export type RowStatus =
  | 'pending'
  | 'running'
  | 'done' // created, and the page confirmed it
  | 'unconfirmed' // created as far as the tool can tell, but the page showed no success notice
  | 'filled' // dry run
  | 'duplicate'
  | 'rejected'
  | 'error';

export interface BatchSummary {
  ok: number;
  unconfirmed: number;
  duplicates: number;
  failed: number;
  cancelled: boolean;
  aborted: boolean;
}

export interface BatchState {
  runId: string | null;
  running: boolean;
  /** The run fills the form but does not submit. */
  dryRun: boolean;
  statuses: RowStatus[];
  /** Per-row message: the page's own text for duplicates/rejections, the tool's for errors. */
  notes: Record<number, string>;
  /** Set when the sidecar stopped the batch on purpose. */
  abortReason: string | null;
  summary: BatchSummary | null;
  /** Wall-clock times (ms since epoch) for the run's duration. */
  startedAt: number | null;
  finishedAt: number | null;
  /** When each row started, and how long each finished row took. */
  rowStartedAt: Record<number, number>;
  rowMs: Record<number, number>;
}

export const initialBatchState = (total = 0): BatchState => ({
  runId: null,
  running: false,
  dryRun: false,
  statuses: Array<RowStatus>(total).fill('pending'),
  notes: {},
  abortReason: null,
  summary: null,
  startedAt: null,
  finishedAt: null,
  rowStartedAt: {},
  rowMs: {},
});

const setAt = (arr: RowStatus[], i: number, v: RowStatus): RowStatus[] =>
  i >= 0 && i < arr.length ? arr.map((s, j) => (j === i ? v : s)) : arr;

/** A row reached its result: status, the page's message, and how long it took. */
const finish = (state: BatchState, i: number, status: RowStatus, note: string | null | undefined, now: number): BatchState => {
  const began = state.rowStartedAt[i];
  return {
    ...state,
    statuses: setAt(state.statuses, i, status),
    notes: note ? { ...state.notes, [i]: note } : state.notes,
    rowMs: began !== undefined ? { ...state.rowMs, [i]: Math.max(0, now - began) } : state.rowMs,
  };
};

export function reduceBatch(state: BatchState, e: BatchEvent, now: number = Date.now()): BatchState {
  const withNote = (s: BatchState, i: number, status: RowStatus, note?: string | null) => finish(s, i, status, note, now);
  switch (e.type) {
    case 'started':
      return { ...initialBatchState(e.total), runId: e.runId, running: true, dryRun: e.dryRun, startedAt: now };
    case 'row-start':
      return {
        ...state,
        statuses: setAt(state.statuses, e.index, 'running'),
        rowStartedAt: { ...state.rowStartedAt, [e.index]: now },
      };
    case 'row-done':
      return e.confirmed === false
        ? withNote(state, e.index, 'unconfirmed', 'The page showed no success message — check this record in the system.')
        : withNote(state, e.index, 'done', e.message);
    case 'row-filled':
      return withNote(state, e.index, 'filled');
    case 'row-duplicate':
      return withNote(state, e.index, 'duplicate', e.message);
    case 'row-rejected':
      return withNote(state, e.index, 'rejected', e.message);
    case 'row-error':
      return withNote(state, e.index, 'error', e.error);
    case 'aborted':
      return { ...state, abortReason: e.error };
    case 'finished':
      return {
        ...state,
        running: false,
        finishedAt: now,
        summary: {
          ok: e.ok,
          unconfirmed: e.unconfirmed ?? 0,
          duplicates: e.duplicates ?? 0,
          failed: e.failed,
          cancelled: e.cancelled,
          aborted: e.aborted,
        },
      };
  }
}

/** One line for the end of a run. */
export function summaryText(s: BatchSummary, dryRun: boolean): string {
  const parts = [
    dryRun
      ? `${s.ok} filled`
      : `${s.ok} created${s.unconfirmed ? ` (${s.unconfirmed} not confirmed by the page)` : ''}`,
  ];
  if (s.duplicates) parts.push(`${s.duplicates} duplicate${s.duplicates === 1 ? '' : 's'} skipped`);
  parts.push(`${s.failed} failed`);
  return `${s.cancelled ? 'Stopped' : 'Finished'}: ${parts.join(', ')}.`;
}

export type ResultFilter = 'all' | 'created' | 'duplicate' | 'failed';

/** Which rows a filter tab shows. Pending/running rows only appear under "all". */
export function matchesFilter(status: RowStatus, f: ResultFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'created':
      return status === 'done' || status === 'unconfirmed' || status === 'filled';
    case 'duplicate':
      return status === 'duplicate';
    case 'failed':
      return status === 'rejected' || status === 'error';
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  return `${m} m ${Math.round(sec - m * 60)} s`;
}
