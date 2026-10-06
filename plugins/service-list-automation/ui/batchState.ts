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
}

export const initialBatchState = (total = 0): BatchState => ({
  runId: null,
  running: false,
  dryRun: false,
  statuses: Array<RowStatus>(total).fill('pending'),
  notes: {},
  abortReason: null,
  summary: null,
});

const setAt = (arr: RowStatus[], i: number, v: RowStatus): RowStatus[] =>
  i >= 0 && i < arr.length ? arr.map((s, j) => (j === i ? v : s)) : arr;

const withNote = (state: BatchState, i: number, status: RowStatus, note?: string | null): BatchState => ({
  ...state,
  statuses: setAt(state.statuses, i, status),
  notes: note ? { ...state.notes, [i]: note } : state.notes,
});

export function reduceBatch(state: BatchState, e: BatchEvent): BatchState {
  switch (e.type) {
    case 'started':
      return { ...initialBatchState(e.total), runId: e.runId, running: true, dryRun: e.dryRun };
    case 'row-start':
      return { ...state, statuses: setAt(state.statuses, e.index, 'running') };
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
