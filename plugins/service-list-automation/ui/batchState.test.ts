import { describe, expect, it } from 'vitest';
import type { BatchEvent } from './api';
import { initialBatchState, reduceBatch } from './batchState';

const run = (events: BatchEvent[]) => events.reduce(reduceBatch, initialBatchState());

describe('reduceBatch', () => {
  it('tracks per-row status and the final summary', () => {
    const s = run([
      { type: 'started', runId: 'run-1', total: 3 },
      { type: 'row-start', index: 0, serviceCode: 'A' },
      { type: 'row-done', index: 0 },
      { type: 'row-start', index: 1, serviceCode: 'B' },
      { type: 'row-error', index: 1, error: 'boom' },
      { type: 'finished', ok: 1, failed: 1, cancelled: false, aborted: false },
    ]);
    expect(s.statuses).toEqual(['done', 'error', 'pending']);
    expect(s.errors).toEqual({ 1: 'boom' });
    expect(s.running).toBe(false);
    expect(s.summary).toEqual({ ok: 1, failed: 1, cancelled: false, aborted: false });
  });

  it('is running between started and finished, and keeps the runId for cancel', () => {
    const s = run([{ type: 'started', runId: 'run-7', total: 2 }]);
    expect(s.running).toBe(true);
    expect(s.runId).toBe('run-7');
  });

  it('records why a batch was aborted', () => {
    const s = run([
      { type: 'started', runId: 'r', total: 2 },
      { type: 'row-error', index: 0, error: 'x' },
      { type: 'aborted', index: 0, error: 'dialog still open' },
      { type: 'finished', ok: 0, failed: 1, cancelled: false, aborted: true },
    ]);
    expect(s.abortReason).toBe('dialog still open');
    expect(s.summary?.aborted).toBe(true);
  });

  it('ignores an index outside the row list instead of growing the array', () => {
    const s = run([
      { type: 'started', runId: 'r', total: 1 },
      { type: 'row-done', index: 5 },
    ]);
    expect(s.statuses).toEqual(['pending']);
  });
});
