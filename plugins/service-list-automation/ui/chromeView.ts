import type { SessionStatus } from './api';

export type ChromeState = 'closed' | 'no-window' | 'no-match' | 'sign-in' | 'ready';

export interface ChromeView {
  state: ChromeState;
  text: string;
  tone: 'idle' | 'starting' | 'live' | 'paused';
  /** Label of the main button: it opens Chrome, a new window, or brings one forward. */
  action: string;
  /** Can the tool close Chrome right now? */
  canClose: boolean;
}

/** What the user should see for a session status. The states mirror what Chrome
 *  is really doing — including the case where only the window was closed. */
export function chromeView(s: SessionStatus | null): ChromeView {
  if (!s || !s.reachable) {
    return { state: 'closed', text: 'Chrome is not open', tone: 'idle', action: 'Open Chrome', canClose: false };
  }
  if (s.pageCount === 0) {
    return {
      state: 'no-window',
      text: 'Chrome is running but its window was closed',
      tone: 'paused',
      action: 'Open window',
      canClose: true,
    };
  }
  if (!s.page) {
    return {
      state: 'no-match',
      text: 'No open tab matches the URL filter (see Settings → Chrome)',
      tone: 'starting',
      action: 'Bring to front',
      canClose: true,
    };
  }
  if (!s.ready) {
    return {
      state: 'sign-in',
      text: 'Chrome is open — sign in and open the service list page',
      tone: 'starting',
      action: 'Bring to front',
      canClose: true,
    };
  }
  return { state: 'ready', text: 'Signed in — ready', tone: 'live', action: 'Bring to front', canClose: true };
}

/** Chrome went away without the tool asking: it was running, now it is not. */
export function closedBehindOurBack(prev: SessionStatus | null, next: SessionStatus): boolean {
  return !!prev?.reachable && !next.reachable;
}
