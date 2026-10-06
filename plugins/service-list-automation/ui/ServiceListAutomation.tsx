import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { StatusDot } from '@/components/ui/status-dot';
import { Switch } from '@/components/ui/switch';
import { CLOSED_STATUS, createApi, type CsvError, type ParsedCsv, type ServiceRow, type SessionStatus } from './api';
import { initialBatchState, reduceBatch, summaryText, type BatchState, type RowStatus } from './batchState';
import { chromeView, closedBehindOurBack } from './chromeView';
import { FixedValues } from './FixedValues';
import { cleanPresets } from './presets';
import { SettingsScreen } from './SettingsScreen';
import { DEFAULT_SETTINGS, setPath, withDefaults, type Settings } from './settings';
import { PreviewDialog } from './PreviewDialog';

const PLUGIN_ID = 'service-list-automation';
const POLL_MS = 2000;

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Created',
  unconfirmed: 'Created? (not confirmed)',
  filled: 'Filled (not submitted)',
  duplicate: 'Duplicate — skipped',
  rejected: 'Rejected by the page',
  error: 'Failed',
};

const section = { display: 'flex', flexDirection: 'column', gap: 8 } as const;
const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 } as const;

type Tab = 'run' | 'settings';

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

  const [saved, setSaved] = usePluginState<unknown>(sdk, 'settings', DEFAULT_SETTINGS);
  // Saved state may be partial or from an older version; always run on the merge.
  const settings = useMemo(() => withDefaults(saved), [saved]);
  const update = useCallback((next: Settings) => setSaved(next), [setSaved]);
  const [savedPresets, setSavedPresets] = usePluginState<unknown>(sdk, 'presets', []);
  const presets = useMemo(() => cleanPresets(savedPresets), [savedPresets]);

  const [tab, setTab] = useState<Tab>('run');
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState<'opening' | 'closing' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [csvName, setCsvName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  // The preview popup: opened from "Preview data" (just to look) or from Start (to run).
  const [preview, setPreview] = useState<null | 'look' | 'run'>(null);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<CsvError[]>([]);
  const [batch, setBatch] = useState<BatchState>(() => initialBatchState());
  const [error, setError] = useState<string | null>(null);
  // Dry run is a property of the session, never saved: every time the plugin opens it is on,
  // so a real run is always a decision taken now, not a leftover setting.
  const [dryRun, setDryRun] = useState(true);

  // Keep the last picked CSV text so changing the header/column settings re-parses it.
  const csvText = useRef<string | null>(null);
  const previous = useRef<SessionStatus | null>(null);
  const closedByUs = useRef(false);

  const refresh = useCallback(async () => {
    let next: SessionStatus;
    try {
      next = await api.sessionStatus(settings);
    } catch {
      next = CLOSED_STATUS;
    }
    // Chrome vanished although the tool did not close it: the user did.
    if (closedBehindOurBack(previous.current, next) && !closedByUs.current) {
      setNotice('Chrome was closed.');
    }
    if (next.reachable) setNotice((n) => (n === 'Chrome was closed.' ? null : n));
    previous.current = next;
    setSession(next);
  }, [api, settings]);

  // Poll so the screen follows Chrome whatever closes or opens it, and look again
  // the moment the window regains focus (the user may just have been in Chrome).
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const view = chromeView(session);

  const parse = useCallback(
    async (text: string, s: Settings) => {
      const result = await api.parseCsv(text, s);
      setParsed(result);
      setRows(result.rows);
      setCsvErrors(result.errors);
      setBatch(initialBatchState(result.rows.length));
    },
    [api],
  );

  // Changing the header or column mapping re-reads the file already chosen.
  const csvKey = JSON.stringify(settings.csv);
  useEffect(() => {
    if (csvText.current === null) return;
    parse(csvText.current, settings).catch((e) => setError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-parse only when the CSV settings change
  }, [csvKey]);

  const openChrome = async () => {
    setError(null);
    setBusy('opening');
    closedByUs.current = false;
    try {
      await api.launchChrome(settings);
      setNotice(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
    await refresh();
    setTimeout(() => void refresh(), 800); // the page is still loading right after launch
  };

  const closeChrome = async () => {
    setError(null);
    setBusy('closing');
    closedByUs.current = true;
    try {
      await api.closeChrome(settings);
      setNotice(null);
    } catch (e) {
      closedByUs.current = false;
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
    await refresh();
  };

  const pickCsv = async () => {
    setError(null);
    try {
      const path = firstPath(await sdk.files.pickOpen({ filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] }));
      if (!path) return;
      const text: string = await sdk.files.readText(path);
      csvText.current = text;
      setCsvName(path.split(/[\\/]/).pop() ?? path);
      await parse(text, settings);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const start = async () => {
    setError(null);
    setBatch(initialBatchState(rows.length));
    try {
      // The promise from `stream` resolves once subscribed; events drive state.
      await api.runBatch(settings, rows, (e) => setBatch((s) => reduceBatch(s, e)), dryRun);
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

  const canRun = view.state === 'ready' && rows.length > 0 && !batch.running;

  // Start always goes through the preview: the run begins from the popup, where the
  // user sees every row exactly as it will be entered.
  const onStart = () => setPreview('run');
  const done = batch.statuses.filter((s) => s !== 'pending' && s !== 'running').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={row}>
        <Segmented<Tab>
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'run', label: 'Run' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {tab === 'settings' && <SettingsScreen settings={settings} onChange={update} />}

      {tab === 'run' && (
        <>
          <div style={section}>
            <strong>1. Chrome</strong>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Opens a separate Chrome with its own profile. Sign in there yourself (SSO / MFA included); your everyday
              Chrome is never touched. Close it here or by hand — this screen follows either.
            </div>
            <label style={{ ...label, maxWidth: 560 }}>
              Service list page URL
              <Input
                value={settings.connection.url}
                placeholder="https://…"
                onChange={(e) => update(setPath(settings, 'connection.url', e.target.value))}
              />
            </label>
            <div style={row}>
              <Button onClick={() => void openChrome()} disabled={busy !== null}>
                {busy === 'opening' ? 'Opening…' : view.action}
              </Button>
              <Button
                variant="outline"
                onClick={() => void closeChrome()}
                disabled={busy !== null || !view.canClose || batch.running}
                title={batch.running ? 'Stop the run first' : undefined}
              >
                {busy === 'closing' ? 'Closing…' : 'Close Chrome'}
              </Button>
              <StatusDot tone={view.tone} />
              <span style={{ fontSize: 12 }}>{view.text}</span>
            </div>
            {notice && <Callout tone="info">{notice} Press “Open Chrome” to start it again.</Callout>}
          </div>

          <div style={section}>
            <strong>2. CSV file</strong>
            <div style={row}>
              <Button variant="outline" onClick={() => void pickCsv()} disabled={batch.running}>
                Choose CSV…
              </Button>
              <label style={{ ...row, fontSize: 12 }}>
                <Switch
                  checked={settings.csv.skipHeader}
                  disabled={batch.running}
                  onCheckedChange={(v) => update(setPath(settings, 'csv.skipHeader', v))}
                />
                First line is a header
              </label>
              {csvName && (
                <span style={{ fontSize: 12 }}>
                  {csvName} — {rows.length} row{rows.length === 1 ? '' : 's'}
                </span>
              )}
              {parsed && rows.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setPreview('look')}>
                  Preview data…
                </Button>
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
            <strong>3. Fixed values (same for every row)</strong>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Saved automatically and reused next time. Type the text exactly as the dropdown shows it.
            </div>
            <FixedValues
              constants={settings.form.constants}
              onChange={(c) => update(setPath(settings, 'form.constants', c))}
              presets={presets}
              onPresets={setSavedPresets}
              disabled={batch.running}
            />
          </div>

          <div style={section}>
            <strong>4. Run</strong>
            <label style={{ ...row, fontSize: 12 }}>
              <Switch checked={dryRun} disabled={batch.running} onCheckedChange={setDryRun} />
              Dry run — fill each form but do not submit (on every time this screen opens)
            </label>
            {!dryRun && rows.length > 0 && (
              <Callout tone="warning">
                Dry run is off. Start will really create {rows.length} service code{rows.length === 1 ? '' : 's'} in the system.
              </Callout>
            )}
            <div style={row}>
              <Button onClick={onStart} disabled={!canRun} variant={dryRun ? 'default' : 'destructive'}>
                {dryRun ? 'Start dry run…' : 'Start (real run)…'}
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
            {view.state !== 'ready' && rows.length > 0 && !batch.running && (
              <div style={{ fontSize: 12, opacity: 0.8 }}>Start is available once Chrome shows “Signed in — ready”.</div>
            )}
            {batch.abortReason && <Callout tone="error">Stopped: {batch.abortReason}</Callout>}
            {batch.summary && !batch.abortReason && (
              <Callout tone={batch.summary.failed > 0 || batch.summary.unconfirmed > 0 ? 'warning' : 'success'}>
                {summaryText(batch.summary, batch.dryRun)}
              </Callout>
            )}
            {rows.length > 0 && (
              <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 12 }}>
                {rows.map((r, i) => (
                  <div key={`${r.serviceCode}-${i}`} style={{ ...row, padding: '2px 0' }}>
                    <span style={{ width: 28, opacity: 0.6 }}>{i + 1}</span>
                    <span style={{ width: 140 }}>{r.serviceCode}</span>
                    <span style={{ flex: 1 }}>{r.merchantName}</span>
                    <span style={{ width: 150 }}>{STATUS_LABEL[batch.statuses[i] ?? 'pending']}</span>
                    {batch.notes[i] && <span style={{ flexBasis: '100%', opacity: 0.8 }}>{batch.notes[i]}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {preview && parsed && (
        <PreviewDialog
          parsed={parsed}
          fileName={csvName}
          settings={settings}
          onClose={() => setPreview(null)}
          action={
            preview === 'run' && canRun
              ? {
                  real: !dryRun,
                  label: dryRun ? 'Start dry run' : 'Submit for real',
                  onRun: () => {
                    setPreview(null);
                    void start();
                  },
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
