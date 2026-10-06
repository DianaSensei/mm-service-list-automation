// Manual end-to-end check of the sidecar against a real Chrome and a fake
// APEX-like page (fake-apex.html: same-origin iframe, cascading selects that
// load asynchronously, a maxlength field, trusted-event probes, an optional
// overlay). Not part of CI — it needs Chrome.
//
//   cargo build
//   node e2e/drive.mjs target/debug/devtool-svc-service-list-automation \
//        "$PWD/e2e/chrome-headless.sh" [scenario ...]
//
// Scenarios: trusted script dry fail window cover retry noretry settle safe outcomes   (default: all)
// Each scenario launches its own headless Chrome (fresh profile) and closes it
// through the sidecar's own `close-chrome`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [BIN, CHROME, ...wanted] = process.argv.slice(2);
const PORT = 9333;
const PAGE = (hash = '#esc') => `file://${resolve(dirname(fileURLToPath(import.meta.url)), 'fake-apex.html')}${hash}`;

function sidecar() {
  const data = mkdtempSync(join(tmpdir(), 'slp-'));
  const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, DEVTOOL_SERVICE_DATA_DIR: data } });
  const waiters = new Map(), events = new Map();
  createInterface({ input: child.stdout }).on('line', (l) => {
    const m = JSON.parse(l); const w = waiters.get(m.id); if (!w) return;
    if (m.stream) { (events.get(m.id) ?? events.set(m.id, []).get(m.id)).push(m); if (m.done) w.resolve(events.get(m.id).filter((e) => e.result).map((e) => e.result)); }
    else if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
  });
  let n = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = String(++n); waiters.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ protocol: 1, id, method, params }) + '\n');
  });
  const stop = async () => { child.stdin.end(); await new Promise((r) => child.on('exit', r)); };
  return { call, stop };
}

const csv = (rows) => ['MID,SERVICE_CODE,SERVICE_DESCRIPTION,MERCHANT,CATEGORY,BU Group code L2,BU Group code L3,BU Group code L4,BU Group code L6', ...rows].join('\n');
const GOOD = (n, merch = 'Shop') => `M${n},SC${n},Desc ${n},${merch},cat,L2A,FASHION,L4A,L6A`;
const BAD = (n) => `M${n},SC${n},Bad ${n},Shop,cat,L2A,NOPE,L4A,L6A`;
// Real submits against the FAKE page: dryRun has to be switched off explicitly, because the
// sidecar's own default is a dry run.
const fast = { behavior: { timeoutMs: 2500, closeTimeoutMs: 2000, dryRun: false } };

const tabs = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === 'page');
const submissions = async () => {
  const t = (await tabs()).find((x) => x.url.includes('fake-apex'));
  const m = t && decodeURIComponent(t.title).match(/^submitted:(.*)$/);
  const v = m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : [];
  return Array.isArray(v) ? v : []; // the page's initial title is "submitted:0"
};
const types = (ev) => ev.map((e) => e.type + (e.index !== undefined ? `#${e.index}` : '')).join(' ');
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function withChrome(hash, fn) {
  const sc = sidecar();
  try {
    await sc.call('launch-chrome', { port: PORT, chromePath: CHROME, url: PAGE(hash) });
    await fn(sc);
  } finally {
    await sc.call('close-chrome', { port: PORT }).catch(() => {});
    await sc.stop();
  }
}
const run = (sc, rows, settings = fast, extra = {}) =>
  sc.call('parse-csv', { text: csv(rows), skipHeader: true }).then((p) =>
    sc.call('run-batch', { rows: p.rows, port: PORT, urlContains: 'fake-apex', settings, ...extra }));

const scenarios = {
  async trusted() {
    await withChrome('#esc', async (sc) => {
      const ev = await run(sc, [GOOD(1, 'Shop One Long Name'), GOOD(2)]);
      const subs = await submissions();
      check(types(ev).includes('finished') && ev.at(-1).ok === 2, `both rows submitted (${types(ev)})`);
      check(subs[0]?.[2] === 'Shop One', `maxlength honoured by real typing: merchant = "${subs[0]?.[2]}"`);
      check(subs[0]?.includes('trustedInput=true'), 'text arrived as trusted input events');
      check(subs[0]?.includes('trustedClick=true'), 'submit was a trusted mouse click');
    });
  },
  async script() {
    await withChrome('#esc', async (sc) => {
      const ev = await run(sc, [GOOD(1, 'Shop One Long Name')], { behavior: { ...fast.behavior, inputMode: 'script' } });
      const subs = await submissions();
      check(ev.at(-1).ok === 1, 'row submitted in script mode');
      check(subs[0]?.[2] === 'Shop One Long Name', `script mode bypasses maxlength (merchant = "${subs[0]?.[2]}")`);
      check(subs[0]?.includes('trustedInput=false'), 'script mode produces untrusted events');
    });
  },
  async dry() {
    await withChrome('#esc', async (sc) => {
      const ev = await run(sc, [GOOD(1), GOOD(2)], { behavior: { ...fast.behavior, dryRun: true, dryRunHoldMs: 200 } });
      check(ev[0].dryRun === true, 'started event flags dryRun');
      check(types(ev).includes('row-filled#0') && types(ev).includes('row-filled#1'), `rows reported as filled (${types(ev)})`);
      check((await submissions()).length === 0, 'nothing was submitted');
      check(ev.at(-1).ok === 2 && ev.at(-1).aborted === false, 'dialog closed cleanly after each dry row');
    });
  },
  async fail() {
    await withChrome('#esc', async (sc) => {
      const ev = await run(sc, [GOOD(1), BAD(2), BAD(3), BAD(4), GOOD(5)], { behavior: { ...fast.behavior, timeoutMs: 600, maxConsecutiveFailures: 3 } });
      const aborted = ev.find((e) => e.type === 'aborted');
      check(!!aborted && /3 rows failed in a row/.test(aborted.error), `aborts after 3 consecutive failures: ${aborted?.error?.slice(0, 80)}`);
      check(/options seen/.test(ev.find((e) => e.type === 'row-error')?.error ?? ''), 'row error lists the options that were available');
      check(!types(ev).includes('row-start#4'), 'the 5th row never started');
    });
  },
  async cover() {
    await withChrome('#esc,cover', async (sc) => {
      const t0 = Date.now();
      const ev = await run(sc, [GOOD(1)]);
      check(ev.at(-1).ok === 1, `row submitted once the overlay lifted (${Date.now() - t0}ms)`);
    });
  },
  async retry() {
    await withChrome('#esc,swallow', async (sc) => {
      const ev = await run(sc, [GOOD(1), GOOD(2), GOOD(3)], { behavior: { ...fast.behavior, afterSubmitSettleMs: 0, dialogOpenWaitMs: 700 }, outcome: { confirmWaitMs: 0 } });
      check(ev.at(-1).ok === 3 && ev.at(-1).failed === 0, `a lost "create" click is repeated: all 3 rows submitted (${types(ev)})`);
      check((await submissions()).length === 3, 'exactly 3 submissions (no duplicate dialogs)');
    });
  },
  async noretry() {
    await withChrome('#esc,swallow', async (sc) => {
      const ev = await run(sc, [GOOD(1), GOOD(2)], { behavior: { ...fast.behavior, afterSubmitSettleMs: 0, createAttempts: 1, timeoutMs: 1200 }, outcome: { confirmWaitMs: 0 } });
      const err = ev.find((e) => e.type === 'row-error');
      check(!!err && /timed out waiting for the form dialog/.test(err.error), 'without retry the failure of the real run is reproduced');
      check(/readyState=complete/.test(err?.error ?? '') && /iframes=0/.test(err?.error ?? ''), `the error carries the page state: ${err?.error?.slice(-90)}`);
    });
  },
  async settle() {
    await withChrome('#esc,swallow', async (sc) => {
      const ev = await run(sc, [GOOD(1), GOOD(2)], { behavior: { ...fast.behavior, afterSubmitSettleMs: 1800, createAttempts: 1 }, outcome: { confirmWaitMs: 0 } });
      check(ev.at(-1).ok === 2, `a long enough pause after submit avoids the lost click on its own (${types(ev)})`);
    });
  },
  async outcomes() {
    await withChrome('#esc,outcomes', async (sc) => {
      const row = (code) => `M-${code},${code},Desc ${code},Shop ${code},cat,L2A,FASHION,L4A,L6A`;
      const ev = await run(sc, [row('A1'), row('a1 '), row('REJ1'), row('SIL1'), row('B1')], fast);
      const at = (i) => ev.filter((e) => e.index === i && e.type !== 'row-start')[0] ?? {};
      check(at(0).type === 'row-done' && at(0).confirmed === true && at(0).message === 'Row created.', `created + confirmed by the page's success notice (${JSON.stringify(at(0))})`);
      check(at(1).type === 'row-duplicate' && at(1).source === 'file', `same code again in the file (case/space-insensitive) is skipped without touching the page (${at(1).message})`);
      check(at(2).type === 'row-rejected' && /not allowed/.test(at(2).message), `a rejection shown after the dialog closed is reported with its text (${at(2).message})`);
      check(at(3).type === 'row-done' && at(3).confirmed === false, 'closed without any notice → created but NOT confirmed (the stale alerts of earlier rows are ignored)');
      check(at(4).type === 'row-done' && at(4).confirmed === true, 'the next row is confirmed again');
      const fin = ev.find((e) => e.type === 'finished');
      check(fin.ok === 3 && fin.unconfirmed === 1 && fin.duplicates === 1 && fin.failed === 1, `summary counts ${JSON.stringify(fin)}`);
      check((await submissions()).length === 3, 'the page recorded exactly 3 creations');

      // Already in the system (created by an earlier batch): the page says so inside the dialog.
      const ev2 = await run(sc, [row('A1'), row('C1')], fast);
      const dup = ev2.find((e) => e.type === 'row-duplicate');
      check(dup?.source === 'page' && /already exists/.test(dup.message), `duplicate reported by the page (${dup?.message})`);
      check(ev2.find((e) => e.type === 'row-done' && e.index === 1), 'skip mode: the run carries on after a duplicate');

      const ev3 = await run(sc, [row('A1'), row('D1')], { behavior: fast.behavior, outcome: { onDuplicate: 'stop' } });
      check(ev3.some((e) => e.type === 'aborted' && /duplicate/.test(e.error)) && !ev3.some((e) => e.type === 'row-start' && e.index === 1), 'stop mode: the run stops at the duplicate');

      const ev4 = await run(sc, [row('E1'), row('E1')], { behavior: fast.behavior, outcome: { skipFileDuplicates: false } });
      check(ev4.some((e) => e.type === 'row-duplicate' && e.source === 'page'), 'with the in-file check off, the page catches the repeat');
      check((await submissions()).filter((r) => r[0] === 'E1').length === 1, '…and still only one record exists');
    });
  },
  async safe() {
    await withChrome('#esc', async (sc) => {
      const p = await sc.call('parse-csv', { text: csv([GOOD(1)]), skipHeader: true });
      // No settings at all: this must NOT submit.
      const ev = await sc.call('run-batch', { rows: p.rows, port: PORT, urlContains: 'fake-apex' });
      check(ev[0].dryRun === true, 'a request with no settings is a dry run');
      check((await submissions()).length === 0, 'nothing was submitted');
    });
  },
  async window() {
    await withChrome('#esc', async (sc) => {
      const st = () => sc.call('session-status', { port: PORT, urlContains: 'fake-apex' });
      let s = await st();
      check(s.reachable && s.ready && s.pageCount === 1, `open window → ready (${JSON.stringify(s)})`);

      await fetch(`http://127.0.0.1:${PORT}/json/close/${(await tabs())[0].id}`);
      await new Promise((r) => setTimeout(r, 400));
      s = await st();
      check(s.reachable && !s.ready && s.pageCount === 0, `user closed the window → no window (${JSON.stringify(s)})`);

      const r = await sc.call('launch-chrome', { port: PORT, chromePath: CHROME, url: PAGE('#esc') });
      check(r.reused && r.openedWindow === true, `"Open Chrome" reopens a window (${JSON.stringify(r)})`);
      await new Promise((x) => setTimeout(x, 800));
      s = await st();
      check(s.ready && s.pageCount === 1, 'new window is ready');

      const r2 = await sc.call('launch-chrome', { port: PORT, chromePath: CHROME });
      check(r2.reused && r2.openedWindow === false, 'with a window already open it only brings it forward');

      // closing the window in the middle of a run stops the run at once
      const p = await sc.call('parse-csv', { text: csv([GOOD(1), GOOD(2), GOOD(3), GOOD(4)]), skipHeader: true });
      const running = sc.call('run-batch', { rows: p.rows, port: PORT, urlContains: 'fake-apex', settings: { behavior: { ...fast.behavior, dryRun: true, dryRunHoldMs: 1500 } } });
      await new Promise((x) => setTimeout(x, 1800));
      await fetch(`http://127.0.0.1:${PORT}/json/close/${(await tabs())[0].id}`);
      const ev = await running;
      const ab = ev.find((e) => e.type === 'aborted');
      check(!!ab && /window was closed/.test(ab.error), `closing the window mid-run aborts it: ${ab?.error?.slice(0, 60)}`);
      check(ev.filter((e) => e.type === 'row-start').length < 4, 'remaining rows were not attempted');

      const busy = sc.call('run-batch', { rows: p.rows, port: PORT, urlContains: 'fake-apex', settings: fast });
      await busy.catch(() => {});
      const c = await sc.call('close-chrome', { port: PORT });
      check(c.closed && c.wasOpen, `close-chrome quits Chrome (${JSON.stringify(c)})`);
      s = await st();
      check(!s.reachable, 'status now reports Chrome as closed');
      const again = await sc.call('close-chrome', { port: PORT });
      check(again.closed && !again.wasOpen, 'closing when already closed is a harmless no-op');
    });
  },
};

for (const name of wanted.length ? wanted : Object.keys(scenarios)) {
  console.log(`\n== ${name}`);
  try { await scenarios[name](); } catch (e) { failures++; console.log('  FAIL  threw:', e.message); }
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
