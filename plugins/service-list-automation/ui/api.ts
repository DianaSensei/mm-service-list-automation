import type { PluginSdk } from '@/platform';

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
}

export interface LaunchResult {
  reused: boolean;
  port: number;
  profileDir?: string;
}

export type BatchEvent =
  | { type: 'started'; runId: string; total: number }
  | { type: 'row-start'; index: number; serviceCode: string }
  | { type: 'row-done'; index: number }
  | { type: 'row-error'; index: number; error: string }
  | { type: 'aborted'; index: number; error: string }
  | { type: 'finished'; ok: number; failed: number; cancelled: boolean; aborted: boolean };

export interface Connection {
  port: number;
  url: string;
  urlContains: string;
  chromePath: string;
}

export const DEFAULT_CONNECTION: Connection = { port: 9222, url: '', urlContains: '', chromePath: '' };

export function createApi(sdk: PluginSdk) {
  return {
    launchChrome: (c: Connection) =>
      sdk.service.call<LaunchResult>('launch-chrome', {
        port: c.port,
        url: c.url || undefined,
        chromePath: c.chromePath || undefined,
      }),
    sessionStatus: (c: Connection) =>
      sdk.service.call<SessionStatus>('session-status', { port: c.port, urlContains: c.urlContains }),
    parseCsv: (text: string, skipHeader: boolean) =>
      sdk.service.call<{ rows: ServiceRow[]; errors: CsvError[] }>('parse-csv', { text, skipHeader }),
    runBatch: (c: Connection, rows: ServiceRow[], onEvent: (e: BatchEvent) => void) =>
      sdk.service.stream<BatchEvent>('run-batch', onEvent, { rows, port: c.port, urlContains: c.urlContains }),
    cancelBatch: (runId: string) => sdk.service.call<{ cancelled: boolean }>('cancel-batch', { runId }),
  };
}

export type Api = ReturnType<typeof createApi>;
