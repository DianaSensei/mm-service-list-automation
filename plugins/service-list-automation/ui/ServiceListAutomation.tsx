import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { StatusDot } from '@/components/ui/status-dot';
import { CLOSED_STATUS, createApi, type CsvError, type ParsedCsv, type ServiceRow, type SessionStatus } from './api';
import { initialBatchState, reduceBatch, type BatchState } from './batchState';
import { chromeView, closedBehindOurBack } from './chromeView';
import { FixedValues } from './FixedValues';
import { cleanPresets } from './presets';
import { SettingsScreen, type ProfileInfo } from './SettingsScreen';
import { DEFAULT_SETTINGS, setPath, withDefaults, type Settings } from './settings';
import { PreviewDialog } from './PreviewDialog';
import { RunResults } from './ResultsTable';
import { cleanPageUrl, cleanRecent, rememberUrl } from './urls';

const PLUGIN_ID = 'service-list-automation';
const POLL_MS = 2000;


const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;
const selectStyle = {
  height: 32,
  padding: '0 6px',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  border: '1px solid var(--line, rgba(128,128,128,0.4))',
  fontSize: 12,
  maxWidth: 260,
} as const;

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
  const [savedRecent, setSavedRecent] = usePluginState<unknown>(sdk, 'recentUrls', []);
  const recentUrls = useMemo(() => cleanRecent(savedRecent), [savedRecent]);

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
  const [profile, setProfile] = useState<ProfileInfo | null>(null);

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
    // Remember the page the user actually works on — typed here or reached in Chrome
    // (after a login redirect, say) — so "Open Chrome" goes straight back to it next time.
    const url = next.ready && next.page ? cleanPageUrl(next.page.url) : null;
    if (url) {
      if (url !== settings.connection.url) update(setPath(settings, 'connection.url', url));
      setSavedRecent((list: unknown) => (cleanRecent(list)[0] === url ? list : rememberUrl(list, url)));
    }
  }, [api, settings, update, setSavedRecent]);

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

  // Look the profile folder up when Settings is shown (it can be created meanwhile).
  useEffect(() => {
    if (tab !== 'settings') return;
    api.profileInfo().then(setProfile, () => setProfile(null));
  }, [api, tab, session?.reachable]);

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
  // Why Start is not available, in one short line (nothing when it is).
  const blocker =
    rows.length === 0 ? 'Choose a CSV file first.' : view.state !== 'ready' ? 'Waiting for Chrome: sign in and open the service list page.' : null;

  // Start always goes through the preview: the run begins from the popup, where the
  // user sees every row exactly as it will be entered.
  const onStart = () => setPreview('run');
  const started = batch.running || batch.summary !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ ...row, marginBottom: 12 }}>
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

      {tab === 'settings' && <SettingsScreen settings={settings} onChange={update} profile={profile} />}

      {tab === 'run' && (
        <>
          <Section title="Chrome">
            <div style={row}>
              <Input
                style={{ flex: 1, minWidth: 260 }}
                value={settings.connection.url}
                placeholder="Service list page URL — remembered from the page you last used"
                onChange={(e) => update(setPath(settings, 'connection.url', e.target.value))}
              />
              {recentUrls.length > 1 && (
                <select
                  style={selectStyle}
                  value=""
                  title="Recent pages"
                  onChange={(e) => e.target.value && update(setPath(settings, 'connection.url', e.target.value))}
                >
                  <option value="">Recent…</option>
                  {recentUrls.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div style={row}>
              <Button onClick={() => void openChrome()} disabled={busy !== null}>
                {busy === 'opening' ? 'Opening…' : view.action}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void closeChrome()}
                disabled={busy !== null || !view.canClose || batch.running}
                title={batch.running ? 'Stop the run first' : undefined}
              >
                {busy === 'closing' ? 'Closing…' : 'Close'}
              </Button>
              <StatusDot tone={view.tone} />
              <span style={{ fontSize: 12 }}>{notice ?? view.text}</span>
            </div>
          </Section>

          <Section title="Data">
            <div style={row}>
              <Button variant="outline" onClick={() => void pickCsv()} disabled={batch.running}>
                {csvName ? 'Change CSV…' : 'Choose CSV…'}
              </Button>
              {csvName && (
                <span style={{ fontSize: 12 }}>
                  <strong>{csvName}</strong>
                  <span style={{ opacity: 0.7 }}>
                    {' '}
                    · {rows.length} row{rows.length === 1 ? '' : 's'}
                  </span>
                </span>
              )}
              {parsed && rows.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setPreview('look')}>
                  Preview
                </Button>
              )}
            </div>
            {csvErrors.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--warn, #b7791f)' }}>
                {csvErrors.length} line{csvErrors.length === 1 ? '' : 's'} skipped —{' '}
                {csvErrors
                  .slice(0, 3)
                  .map((c) => `line ${c.line}: ${c.error}`)
                  .join('; ')}
                {csvErrors.length > 3 ? '…' : ''}
              </div>
            )}
          </Section>

          <Section title="Same for every row">
            <FixedValues
              constants={settings.form.constants}
              onChange={(c) => update(setPath(settings, 'form.constants', c))}
              presets={presets}
              onPresets={setSavedPresets}
              disabled={batch.running}
            />
          </Section>

          <Section title="Run" last>
            <div style={row}>
              <div style={batch.running ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>
                <Segmented<'dry' | 'real'>
                  value={dryRun ? 'dry' : 'real'}
                  onValueChange={(v) => setDryRun(v === 'dry')}
                  options={[
                    { value: 'dry', label: 'Dry run' },
                    { value: 'real', label: 'Real run' },
                  ]}
                />
              </div>
              {!batch.running && (
                <Button onClick={onStart} disabled={!canRun} variant={dryRun ? 'default' : 'destructive'}>
                  {dryRun
                    ? 'Preview & dry run'
                    : `Preview & create ${rows.length || ''} service code${rows.length === 1 ? '' : 's'}`.replace('  ', ' ')}
                </Button>
              )}
            </div>
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              {blocker && !batch.running
                ? blocker
                : dryRun
                  ? 'Dry run fills each form and closes it without submitting. It is selected every time this screen opens.'
                  : 'Real run submits every row: records are created in the system.'}
            </div>

            {batch.abortReason && <Callout tone="error">Stopped early: {batch.abortReason}</Callout>}
            {started && (
              <RunResults rows={rows} batch={batch} onStop={() => void stop()} onRunAgain={onStart} canRunAgain={canRun} />
            )}
          </Section>
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

/** A titled block of the Run screen: small heading, hairline between blocks. */
function Section({ title, last, children }: { title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 0',
        borderBottom: last ? undefined : '1px solid var(--line, rgba(128,128,128,0.2))',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.6 }}>{title}</div>
      {children}
    </section>
  );
}
