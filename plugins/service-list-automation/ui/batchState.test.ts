import { describe, expect, it } from 'vitest';
import type { BatchEvent } from './api';
import { initialBatchState, reduceBatch, summaryText } from './batchState';

const run = (events: BatchEvent[]) => events.reduce(reduceBatch, initialBatchState());
const start = (total: number, dryRun = false): BatchEvent => ({ type: 'started', runId: 'r', total, dryRun });

describe('reduceBatch', () => {
  it('gives every kind of result its own status, with the page’s message', () => {
    const s = run([
      start(6),
      { type: 'row-done', index: 0, confirmed: true, message: 'Row created.' },
      { type: 'row-done', index: 1, confirmed: false, message: null },
      { type: 'row-duplicate', index: 2, source: 'page', message: 'Service Code X already exists.' },
      { type: 'row-duplicate', index: 3, source: 'file', message: 'same service code as row 1 of this file — skipped' },
      { type: 'row-rejected', index: 4, message: 'Merchant is not allowed.' },
      { type: 'row-error', index: 5, error: 'timed out waiting for the form dialog' },
    ]);
    expect(s.statuses).toEqual(['done', 'unconfirmed', 'duplicate', 'duplicate', 'rejected', 'error']);
    expect(s.notes[0]).toBe('Row created.');
    expect(s.notes[1]).toMatch(/check this record/);
    expect(s.notes[2]).toMatch(/already exists/);
    expect(s.notes[4]).toBe('Merchant is not allowed.');
    expect(s.notes[5]).toMatch(/timed out/);
  });

  it('an old sidecar without `confirmed` still counts as done', () => {
    expect(run([start(1), { type: 'row-done', index: 0 }]).statuses).toEqual(['done']);
  });

  it('is running between started and finished, and keeps the runId for cancel', () => {
    const s = run([start(2)]);
    expect(s.running).toBe(true);
    expect(s.runId).toBe('r');
  });

  it('records why a batch was aborted and the summary counts', () => {
    const s = run([
      start(2),
      { type: 'row-error', index: 0, error: 'x' },
      { type: 'aborted', index: 0, error: 'dialog still open' },
      { type: 'finished', ok: 0, failed: 1, cancelled: false, aborted: true },
    ]);
    expect(s.abortReason).toBe('dialog still open');
    expect(s.summary).toEqual({ ok: 0, unconfirmed: 0, duplicates: 0, failed: 1, cancelled: false, aborted: true });
  });

  it('marks dry-run rows as filled', () => {
    const s = run([start(2, true), { type: 'row-filled', index: 0 }]);
    expect(s.dryRun).toBe(true);
    expect(s.statuses).toEqual(['filled', 'pending']);
  });

  it('ignores an index outside the row list instead of growing the array', () => {
    expect(run([start(1), { type: 'row-done', index: 5 }]).statuses).toEqual(['pending']);
  });
});

describe('summaryText', () => {
  it('names each outcome that happened', () => {
    expect(summaryText({ ok: 3, unconfirmed: 1, duplicates: 2, failed: 1, cancelled: false, aborted: false }, false)).toBe(
      'Finished: 3 created (1 not confirmed by the page), 2 duplicates skipped, 1 failed.',
    );
    expect(summaryText({ ok: 2, unconfirmed: 0, duplicates: 0, failed: 0, cancelled: true, aborted: false }, true)).toBe(
      'Stopped: 2 filled, 0 failed.',
    );
  });
});
