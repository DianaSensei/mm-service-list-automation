import { describe, expect, it } from 'vitest';
import type { BatchEvent } from './api';
import { formatDuration, initialBatchState, matchesFilter, recentIndices, reduceBatch, rowMatches, summaryText } from './batchState';

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

describe('timing', () => {
  it('measures each row and the whole run', () => {
    let s = reduceBatch(initialBatchState(), { type: 'started', runId: 'r', total: 2, dryRun: false }, 1000);
    s = reduceBatch(s, { type: 'row-start', index: 0, serviceCode: 'a' }, 1100);
    s = reduceBatch(s, { type: 'row-done', index: 0, confirmed: true }, 1450);
    s = reduceBatch(s, { type: 'row-start', index: 1, serviceCode: 'b' }, 1500);
    s = reduceBatch(s, { type: 'row-duplicate', index: 1, source: 'page', message: 'x' }, 1700);
    s = reduceBatch(s, { type: 'finished', ok: 1, failed: 0, cancelled: false, aborted: false }, 1800);
    expect(s.rowMs).toEqual({ 0: 350, 1: 200 });
    expect([s.startedAt, s.finishedAt]).toEqual([1000, 1800]);
  });

  it('formats durations the way the API runner does', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_340)).toBe('12.3 s');
    expect(formatDuration(125_000)).toBe('2 m 5 s');
  });
});

describe('matchesFilter', () => {
  it('groups results into the filter tabs', () => {
    expect(matchesFilter('unconfirmed', 'created')).toBe(true);
    expect(matchesFilter('filled', 'created')).toBe(true);
    expect(matchesFilter('rejected', 'failed')).toBe(true);
    expect(matchesFilter('error', 'failed')).toBe(true);
    expect(matchesFilter('duplicate', 'failed')).toBe(false);
    expect(matchesFilter('pending', 'created')).toBe(false);
    expect(matchesFilter('pending', 'all')).toBe(true);
  });
});

describe('recentIndices', () => {
  const st = (done: number, total: number, running = true) =>
    Array.from({ length: total }, (_, i) => (i < done ? 'done' : i === done && running ? 'running' : 'pending')) as Parameters<typeof recentIndices>[0];

  it('shows everything when there are few rows', () => {
    expect(recentIndices(st(1, 3), 5)).toEqual([0, 1, 2]);
  });
  it('shows the first rows before the run starts', () => {
    expect(recentIndices(st(0, 20, false), 5)).toEqual([0, 1, 2, 3, 4]);
  });
  it('follows the run: the last rows that have started, ending at the current one', () => {
    expect(recentIndices(st(12, 20), 5)).toEqual([8, 9, 10, 11, 12]);
    expect(recentIndices(st(2, 20), 5)).toEqual([0, 1, 2]);
  });
  it('ends on the last row after the run', () => {
    expect(recentIndices(st(20, 20, false), 5)).toEqual([15, 16, 17, 18, 19]);
  });
});

describe('rowMatches', () => {
  it('searches code, merchant and message, ignoring case', () => {
    expect(rowMatches('m4b0', 'm4b01xe', 'Shop', undefined)).toBe(true);
    expect(rowMatches('tiệm', 'x', 'TIỆM NƯỚC', undefined)).toBe(true);
    expect(rowMatches('already', 'x', 'y', 'Service code already exists.')).toBe(true);
    expect(rowMatches('zzz', 'x', 'y', 'z')).toBe(false);
    expect(rowMatches('  ', 'x', 'y', undefined)).toBe(true);
  });
});
