import { describe, expect, it } from 'vitest';
import type { SessionStatus } from './api';
import { chromeView, closedBehindOurBack } from './chromeView';

const st = (o: Partial<SessionStatus>): SessionStatus => ({ reachable: true, ready: false, page: null, pageCount: 1, ...o });
const page = { title: 't', url: 'u' };

describe('chromeView', () => {
  it('maps each real Chrome situation to its own state', () => {
    expect(chromeView(null).state).toBe('closed');
    expect(chromeView(st({ reachable: false, pageCount: 0 })).state).toBe('closed');
    expect(chromeView(st({ pageCount: 0 })).state).toBe('no-window');
    expect(chromeView(st({ pageCount: 2, page: null })).state).toBe('no-match');
    expect(chromeView(st({ page })).state).toBe('sign-in');
    expect(chromeView(st({ page, ready: true })).state).toBe('ready');
  });

  it('offers to open a window when the user closed the last one', () => {
    expect(chromeView(st({ pageCount: 0 })).action).toBe('Open window');
    expect(chromeView(st({ pageCount: 0 })).canClose).toBe(true);
  });

  it('cannot close what is not open', () => {
    expect(chromeView(null).canClose).toBe(false);
    expect(chromeView(null).action).toBe('Open Chrome');
  });
});

describe('closedBehindOurBack', () => {
  it('is true only on a running → gone transition', () => {
    const running = st({ page, ready: true });
    const gone = st({ reachable: false, pageCount: 0 });
    expect(closedBehindOurBack(running, gone)).toBe(true);
    expect(closedBehindOurBack(null, gone)).toBe(false);
    expect(closedBehindOurBack(gone, gone)).toBe(false);
    expect(closedBehindOurBack(gone, running)).toBe(false);
  });
});
