import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { StatusDot } from '@/components/ui/status-dot';
import {
  DEFAULT_CONNECTION,
  createApi,
  type Connection,
  type CsvError,
  type ServiceRow,
  type SessionStatus,
} from './api';
import { initialBatchState, reduceBatch, type BatchState, type RowStatus } from './batchState';

const PLUGIN_ID = 'service-list-automation';
const POLL_MS = 4000;

const STATUS_LABEL: Record<RowStatus, string> = { pending: 'Pending', running: 'Running', done: 'Done', error: 'Failed' };

const section = { display: 'flex', flexDirection: 'column', gap: 8 } as const;
const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 } as const;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function firstPath(picked: unknown): string | null {
  if (typeof picked === 'string') return picked;
  if (Array.isArray(picked) && typeof picked[0] === 'string') return picked[0];
  return null;
}

export function ServiceListAutomation() {
  const sdk = usePluginSdkFor(PLUGIN_ID);
  const api = useMemo(() => createApi(sdk), [sdk]);

  const [conn, setConn] = usePluginState<Connection>(sdk, 'connection', DEFAULT_CONNECTION);
  const [skipHeader, setSkipHeader] = usePluginState<boolean>(sdk, 'skipHeader', true);

  const [session, setSession] = useState<SessionStatus | null>(null);
  const [launching, setLaunching] = useState(false);
  const [csvName, setCsvName] = useState<string | null>(null);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<CsvError[]>([]);
  const [batch, setBatch] = useState<BatchState>(() => initialBatchState());
  const [error, setError] = useState<string | null>(null);

  // Keep the last picked CSV text so toggling "first line is a header" re-parses it.
  const csvText = useRef<string | null>(null);

  // Poll the Chrome session so the UI notices when the user finishes signing in.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.sessionStatus(conn);
        if (alive) setSession(s);
      } catch {
        if (alive) setSession({ reachable: false, ready: false, page: null });
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, conn]);

  const parse = useCallback(
    async (text: string, header: boolean) => {
      const parsed = await api.parseCsv(text, header);
      setRows(parsed.rows);
      setCsvErrors(parsed.errors);
      setBatch(initialBatchState(parsed.rows.length));
    },
    [api],
  );

  const openChrome = async () => {
    setError(null);
    setLaunching(true);
    try {
      await api.launchChrome(conn);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLaunching(false);
    }
  };

  const pickCsv = async () => {
    setError(null);
    try {
      const path = firstPath(await sdk.files.pickOpen({ filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] }));
      if (!path) return;
      const text: string = await sdk.files.readText(path);
      csvText.current = text;
      setCsvName(path.split(/[\\/]/).pop() ?? path);
      await parse(text, skipHeader);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleHeader = async (value: boolean) => {
    setSkipHeader(value);
    if (csvText.current === null) return;
    try {
      await parse(csvText.current, value);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const start = async () => {
    setError(null);
    setBatch(initialBatchState(rows.length));
    try {
      // The promise from `stream` only resolves once subscribed; events drive state.
      await api.runBatch(conn, rows, (e) => setBatch((s) => reduceBatch(s, e)));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const stop = async () => {
    if (!batch.runId) return;
    try {
      await api.cancelBatch(batch.runId);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const tone = !session?.reachable ? 'idle' : session.ready ? 'live' : 'starting';
  const statusText = !session?.reachable
    ? 'Chrome is not open'
    : session.ready
      ? 'Signed in — ready'
      : 'Chrome is open — sign in and open the service list page';
  const canRun = !!session?.ready && rows.length > 0 && !batch.running;
  const done = batch.statuses.filter((s) => s === 'done' || s === 'error').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24, overflowY: 'auto', height: '100%' }}>
      {error && <Callout tone="error">{error}</Callout>}

      <div style={section}>
        <strong>1. Chrome session</strong>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Opens a separate Chrome with its own profile. Sign in there yourself (SSO / MFA included); your everyday
          Chrome is never touched, and the login is kept for next time.
        </div>
        <div style={row}>
          <label style={{ ...label, flex: 1 }}>
            Service list page URL
            <Input
              value={conn.url}
              placeholder="https://…"
              onChange={(e) => setConn({ ...conn, url: e.target.value })}
            />
          </label>
          <label style={{ ...label, width: 110 }}>
            Debug port
            <Input
              type="number"
              value={conn.port}
              onChange={(e) => setConn({ ...conn, port: Number(e.target.value) || DEFAULT_CONNECTION.port })}
            />
          </label>
        </div>
        <div style={row}>
          <label style={{ ...label, flex: 1 }}>
            Only use the tab whose URL contains (optional)
            <Input value={conn.urlContains} onChange={(e) => setConn({ ...conn, urlContains: e.target.value })} />
          </label>
          <label style={{ ...label, flex: 1 }}>
            Chrome path (optional, auto-detected)
            <Input value={conn.chromePath} onChange={(e) => setConn({ ...conn, chromePath: e.target.value })} />
          </label>
        </div>
        <div style={row}>
          <Button onClick={() => void openChrome()} disabled={launching}>
            {launching ? 'Opening…' : session?.reachable ? 'Chrome is open' : 'Open Chrome'}
          </Button>
          <StatusDot tone={tone} />
          <span style={{ fontSize: 12 }}>{statusText}</span>
        </div>
      </div>

      <div style={section}>
        <strong>2. CSV file</strong>
        <div style={row}>
          <Button variant="outline" onClick={() => void pickCsv()} disabled={batch.running}>
            Choose CSV…
          </Button>
          <label style={{ ...row, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={skipHeader}
              disabled={batch.running}
              onChange={(e) => void toggleHeader(e.target.checked)}
            />
            First line is a header
          </label>
          {csvName && (
            <span style={{ fontSize: 12 }}>
              {csvName} — {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {csvErrors.length > 0 && (
          <Callout tone="warning">
            {csvErrors.length} line{csvErrors.length === 1 ? '' : 's'} skipped:{' '}
            {csvErrors
              .slice(0, 5)
              .map((c) => `line ${c.line}: ${c.error}`)
              .join('; ')}
            {csvErrors.length > 5 ? '…' : ''}
          </Callout>
        )}
      </div>

      <div style={section}>
        <strong>3. Run</strong>
        <div style={row}>
          <Button onClick={() => void start()} disabled={!canRun}>
            Start
          </Button>
          <Button variant="outline" onClick={() => void stop()} disabled={!batch.running}>
            Stop after current row
          </Button>
          {rows.length > 0 && (
            <span style={{ fontSize: 12 }}>
              {done} / {rows.length}
            </span>
          )}
        </div>
        {batch.abortReason && <Callout tone="error">Stopped: {batch.abortReason}</Callout>}
        {batch.summary && !batch.abortReason && (
          <Callout tone={batch.summary.failed > 0 ? 'warning' : 'success'}>
            {batch.summary.cancelled ? 'Stopped. ' : 'Finished. '}
            {batch.summary.ok} done, {batch.summary.failed} failed.
          </Callout>
        )}
        {rows.length > 0 && (
          <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 12 }}>
            {rows.map((r, i) => (
              <div key={`${r.serviceCode}-${i}`} style={{ ...row, padding: '2px 0' }}>
                <span style={{ width: 28, opacity: 0.6 }}>{i + 1}</span>
                <span style={{ width: 140 }}>{r.serviceCode}</span>
                <span style={{ flex: 1 }}>{r.merchantName}</span>
                <span style={{ width: 70 }}>{STATUS_LABEL[batch.statuses[i] ?? 'pending']}</span>
                {batch.errors[i] && <span style={{ flexBasis: '100%', opacity: 0.8 }}>{batch.errors[i]}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
