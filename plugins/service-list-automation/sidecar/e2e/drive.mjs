// Manual end-to-end check of the sidecar against a real Chrome and a fake
// APEX-like page (fake-apex.html: same-origin iframe, cascading selects that
// load asynchronously, a row that fails). Not part of CI — needs Chrome.
//
//   cargo build
//   rm -rf /tmp/slp && node e2e/drive.mjs \
//     target/debug/devtool-svc-service-list-automation \
//     "file://$PWD/e2e/fake-apex.html#esc" "$PWD/e2e/chrome-headless.sh" /tmp/slp
//
// `#esc` makes the fake dialog close on Escape (recovery path); without it the
// failed row leaves the dialog open and the batch must abort instead.
// Afterwards: kill the headless Chrome on port 9333.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const BIN = process.argv[2], PAGE = process.argv[3], CHROME = process.argv[4], PROFILE = process.argv[5];
const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, DEVTOOL_SERVICE_DATA_DIR: PROFILE } });
const waiters = new Map(); const events = new Map();
createInterface({ input: child.stdout }).on('line', (l) => {
  const m = JSON.parse(l); const w = waiters.get(m.id); if (!w) return console.log('UNROUTED', l);
  if (m.stream) { (events.get(m.id) ?? events.set(m.id, []).get(m.id)).push(m); if (m.done) w.resolve(events.get(m.id)); }
  else if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
});
let n = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = String(++n); waiters.set(id, { resolve, reject });
  child.stdin.write(JSON.stringify({ protocol: 1, id, method, params }) + '\n');
});
const show = (t, v) => console.log(`\n## ${t}\n`, JSON.stringify(v));
try {
  show('detect-chrome', await call('detect-chrome'));
  show('status before launch', await call('session-status', { port: 9333 }));
  show('launch-chrome', await call('launch-chrome', { port: 9333, chromePath: CHROME, url: PAGE }));
  show('launch again (reused)', await call('launch-chrome', { port: 9333, chromePath: CHROME }));
  show('status', await call('session-status', { port: 9333, urlContains: 'fake-apex' }));
  const csv = [
    'MID,SC,DESC,MERCH,x,y,L2,L3,L4,L6',
    'M1,SC1,"First, desc",Shop One,,,L2A,GROCERY,L4A,L6A',
    'M2,SC2,Second desc,Shop Two,,,L2B,FASHION,L4A,L6B',
    'M3,SC3,Bad row,Shop Three,,,L2A,NOPE,L4A,L6A',
    'M4,SC4,Fourth,Shop Four,,,L2A,FASHION,L4A,L6A',
  ].join('\n');
  const parsed = await call('parse-csv', { text: csv, skipHeader: true });
  show('parse-csv', { rows: parsed.rows.length, errors: parsed.errors });
  const ev = await call('run-batch', { rows: parsed.rows, port: 9333, urlContains: 'fake-apex', settings: { timeoutMs: 2500, closeTimeoutMs: 2000 } });
  show('run-batch events', ev.map((e) => e.result ?? 'DONE'));
  const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
  show('page title (submissions as the page saw them)', decodeURIComponent(tabs.find((t) => t.url.includes('fake-apex')).title));
  // second run while idle works; concurrent + cancel
  const p = call('run-batch', { rows: [parsed.rows[0], parsed.rows[1], parsed.rows[1], parsed.rows[1]], port: 9333, urlContains: 'fake-apex', settings: { timeoutMs: 2500 } });
  await new Promise((r) => setTimeout(r, 600));
  show('concurrent run rejected', await call('run-batch', { rows: [parsed.rows[0]], port: 9333 }).catch((e) => e.message));
  show('cancel', await call('cancel-batch', { runId: 'run-2' }));
  const ev2 = await p; show('cancelled run tail', ev2.map((e) => e.result ?? 'DONE').slice(-2));
  show('unknown method', await call('nope').catch((e) => e.message));
} catch (e) { console.log('FAILED', e.message); process.exitCode = 1; }
finally { child.stdin.end(); await new Promise((r) => child.on('exit', r)); console.log('\nsidecar exited on stdin EOF'); }
