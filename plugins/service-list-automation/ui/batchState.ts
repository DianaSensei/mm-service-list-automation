import type { BatchEvent } from './api';

export type RowStatus = 'pending' | 'running' | 'done' | 'error';

export interface BatchState {
  runId: string | null;
  running: boolean;
  statuses: RowStatus[];
  errors: Record<number, string>;
  /** Set when the sidecar stopped the batch on purpose (dialog stuck open). */
  abortReason: string | null;
  summary: { ok: number; failed: number; cancelled: boolean; aborted: boolean } | null;
}

export const initialBatchState = (total = 0): BatchState => ({
  runId: null,
  running: false,
  statuses: Array<RowStatus>(total).fill('pending'),
  errors: {},
  abortReason: null,
  summary: null,
});

const setAt = (arr: RowStatus[], i: number, v: RowStatus): RowStatus[] =>
  i >= 0 && i < arr.length ? arr.map((s, j) => (j === i ? v : s)) : arr;

export function reduceBatch(state: BatchState, e: BatchEvent): BatchState {
  switch (e.type) {
    case 'started':
      return { ...initialBatchState(e.total), runId: e.runId, running: true };
    case 'row-start':
      return { ...state, statuses: setAt(state.statuses, e.index, 'running') };
    case 'row-done':
      return { ...state, statuses: setAt(state.statuses, e.index, 'done') };
    case 'row-error':
      return {
        ...state,
        statuses: setAt(state.statuses, e.index, 'error'),
        errors: { ...state.errors, [e.index]: e.error },
      };
    case 'aborted':
      return { ...state, abortReason: e.error };
    case 'finished':
      return {
        ...state,
        running: false,
        summary: { ok: e.ok, failed: e.failed, cancelled: e.cancelled, aborted: e.aborted },
      };
  }
}
