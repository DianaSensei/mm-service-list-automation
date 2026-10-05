import type { PluginSdk } from '@/platform';
import { sidecarSettings, type Settings } from './settings';

export interface ServiceRow {
  mid: string;
  serviceCode: string;
  serviceDescription: string;
  merchantName: string;
  l2: string;
  l3: string;
  l4: string;
  l6: string;
}

export interface CsvError {
  line: number;
  error: string;
}

export interface SessionStatus {
  reachable: boolean;
  /** The create button is on the page, i.e. the user is signed in. */
  ready: boolean;
  page: { title: string; url: string } | null;
  /** Tabs Chrome has open. 0 with `reachable` = running but every window was closed. */
  pageCount: number;
}

export interface LaunchResult {
  reused: boolean;
  port: number;
  /** Chrome was already running with no window, so a new one was opened. */
  openedWindow?: boolean;
  profileDir?: string;
}

export type BatchEvent =
  | { type: 'started'; runId: string; total: number; dryRun: boolean }
  | { type: 'row-start'; index: number; serviceCode: string }
  | { type: 'row-done'; index: number }
  | { type: 'row-filled'; index: number }
  | { type: 'row-error'; index: number; error: string }
  | { type: 'aborted'; index: number; error: string }
  | { type: 'finished'; ok: number; failed: number; cancelled: boolean; aborted: boolean };

export const CLOSED_STATUS: SessionStatus = { reachable: false, ready: false, page: null, pageCount: 0 };

export function createApi(sdk: PluginSdk) {
  return {
    launchChrome: (s: Settings) =>
      sdk.service.call<LaunchResult>('launch-chrome', {
        port: s.connection.port,
        url: s.connection.url || undefined,
        chromePath: s.connection.chromePath || undefined,
      }),
    closeChrome: (s: Settings) =>
      sdk.service.call<{ closed: boolean; wasOpen: boolean }>('close-chrome', { port: s.connection.port }),
    sessionStatus: (s: Settings) =>
      sdk.service.call<SessionStatus>('session-status', {
        port: s.connection.port,
        urlContains: s.connection.urlContains,
        settings: sidecarSettings(s),
      }),
    parseCsv: (text: string, s: Settings) =>
      sdk.service.call<{ rows: ServiceRow[]; errors: CsvError[] }>('parse-csv', {
        text,
        skipHeader: s.csv.skipHeader,
        columns: s.csv.columns,
      }),
    runBatch: (s: Settings, rows: ServiceRow[], onEvent: (e: BatchEvent) => void) =>
      sdk.service.stream<BatchEvent>('run-batch', onEvent, {
        rows,
        port: s.connection.port,
        urlContains: s.connection.urlContains,
        settings: sidecarSettings(s),
      }),
    cancelBatch: (runId: string) => sdk.service.call<{ cancelled: boolean }>('cancel-batch', { runId }),
  };
}

export type Api = ReturnType<typeof createApi>;
