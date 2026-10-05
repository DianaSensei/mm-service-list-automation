// DevTool Tier-B sidecar for the service-list-automation plugin.
//
// It does NOT log in and does NOT touch the user's everyday Chrome profile:
// `launch-chrome` opens a Chrome with a dedicated profile and a debugging
// port, the user signs in themselves in that window (SSO / MFA included), and
// `run-batch` then drives that same window over CDP — see docs/ in the
// repository README for why this beats Selenium on a real profile.
//
// Protocol contract (docs/plugin-sdk/04-tier-b-sidecars.md in the host repo):
// JSONL on stdin; at least one response line carrying the request `id`; a
// stream ends with `done: true`; exit when stdin closes; NOTHING but JSON on
// stdout — all logging goes to stderr.
//
// Methods:
//   launch-chrome   { port?, chromePath?, profileDir?, url? }
//   session-status  { port?, urlContains?, settings? }   → { reachable, ready, page }
//   parse-csv       { text, skipHeader? }                → { rows, errors }
//   run-batch       { rows, port?, urlContains?, settings? }   (stream)
//   cancel-batch    { runId }

mod cdp;
mod chrome;
mod form;
mod rows;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::cdp::Cdp;
use crate::form::FormSettings;
use crate::rows::ServiceRow;

const SERVICE_PROTOCOL: u32 = 1;
const DEFAULT_PORT: u16 = 9222;

#[derive(Deserialize)]
struct Request {
    protocol: u32,
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: Value,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize)]
struct Response {
    protocol: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    stream: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    done: bool,
}

impl Response {
    fn once(id: String, result: Value) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id,
            result: Some(result),
            error: None,
            stream: false,
            done: false,
        }
    }
    fn err(id: String, message: impl Into<String>) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id,
            result: None,
            error: Some(message.into()),
            stream: false,
            done: false,
        }
    }
    fn event(id: String, result: Value) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id,
            result: Some(result),
            error: None,
            stream: true,
            done: false,
        }
    }
    fn done(id: String) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id,
            result: None,
            error: None,
            stream: true,
            done: true,
        }
    }
}

type Tx = mpsc::UnboundedSender<Response>;

// ── Batch registry ───────────────────────────────────────────────────────────
// The host's stream-stop does not reach the sidecar, so stopping a batch is an
// explicit `cancel-batch` request carrying the `runId` from the first event.
// Only one batch may run at a time: two would fight over the same page.

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);
static BATCH_ACTIVE: AtomicBool = AtomicBool::new(false);

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(Default::default)
}

/// Releases the single-batch slot and registry entry however the run ends.
struct BatchGuard(String);
impl Drop for BatchGuard {
    fn drop(&mut self) {
        cancels().lock().unwrap().remove(&self.0);
        BATCH_ACTIVE.store(false, Ordering::SeqCst);
    }
}

// ── Params ───────────────────────────────────────────────────────────────────

fn parse<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|e| format!("invalid params: {e}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SessionParams {
    port: u16,
    url_contains: String,
    settings: FormSettings,
}
impl Default for SessionParams {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            url_contains: String::new(),
            settings: FormSettings::default(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchParams {
    #[serde(default = "default_port")]
    port: u16,
    chrome_path: Option<String>,
    profile_dir: Option<String>,
    url: Option<String>,
}
fn default_port() -> u16 {
    DEFAULT_PORT
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvParams {
    text: String,
    #[serde(default)]
    skip_header: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchParams {
    rows: Vec<ServiceRow>,
    #[serde(flatten)]
    session: SessionParams,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelParams {
    run_id: String,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// Where Chrome's dedicated profile lives: inside the sidecar's own isolated
/// data dir (set by the host), so uninstalling/cleaning is one folder.
fn default_profile_dir() -> PathBuf {
    let base = std::env::var_os("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("devtool-svc-service-list-automation"));
    base.join("chrome-profile")
}

async fn launch_chrome(params: Value) -> Result<Value, String> {
    let p: LaunchParams = parse(params)?;
    if chrome::is_reachable(p.port).await {
        return Ok(json!({ "reused": true, "port": p.port }));
    }
    let chrome_path = match p.chrome_path.filter(|s| !s.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => chrome::detect_chrome().ok_or("Chrome was not found; set its path manually")?,
    };
    let profile = p
        .profile_dir
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_profile_dir);
    std::fs::create_dir_all(&profile)
        .map_err(|e| format!("cannot create profile dir {}: {e}", profile.display()))?;

    let args = chrome::launch_args(p.port, &profile, p.url.as_deref());
    let pid = chrome::spawn_chrome(&chrome_path, &args)
        .map_err(|e| format!("cannot start {}: {e}", chrome_path.display()))?;

    for _ in 0..60 {
        if chrome::is_reachable(p.port).await {
            return Ok(json!({
                "reused": false,
                "port": p.port,
                "pid": pid,
                "chromePath": chrome_path,
                "profileDir": profile,
            }));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(format!(
        "Chrome started but port {} never opened. If a Chrome using this profile is already running without \
         --remote-debugging-port, close it and try again.",
        p.port
    ))
}

async fn connect_page(session: &SessionParams) -> Result<(Cdp, chrome::Target), String> {
    if !chrome::is_reachable(session.port).await {
        return Err(format!(
            "no Chrome listening on port {} — open it with \"Open Chrome\" first",
            session.port
        ));
    }
    let targets = chrome::list_targets(session.port).await?;
    let page = chrome::pick_page(&targets, &session.url_contains)
        .ok_or("no matching Chrome tab found (check the page URL filter)")?;
    let ws = page
        .web_socket_debugger_url
        .clone()
        .ok_or("tab is not debuggable")?;
    Ok((Cdp::connect(&ws).await?, page))
}

async fn session_status(params: Value) -> Result<Value, String> {
    let s: SessionParams = parse(params)?;
    if !chrome::is_reachable(s.port).await {
        return Ok(json!({ "reachable": false, "ready": false, "page": null }));
    }
    let targets = chrome::list_targets(s.port).await?;
    let Some(page) = chrome::pick_page(&targets, &s.url_contains) else {
        return Ok(json!({ "reachable": true, "ready": false, "page": null }));
    };
    let ws = page
        .web_socket_debugger_url
        .clone()
        .ok_or("tab is not debuggable")?;
    let mut cdp = Cdp::connect(&ws).await?;
    let ready = form::is_ready(&mut cdp, &s.settings).await?;
    Ok(
        json!({ "reachable": true, "ready": ready, "page": { "title": page.title, "url": page.url } }),
    )
}

async fn run_batch(id: String, params: Value, tx: Tx) {
    match run_batch_inner(&id, params, &tx).await {
        Ok(()) => {}
        Err(e) => {
            let _ = tx.send(Response::err(id, e));
            return;
        }
    }
    let _ = tx.send(Response::done(id));
}

async fn run_batch_inner(id: &str, params: Value, tx: &Tx) -> Result<(), String> {
    let p: BatchParams = parse(params)?;
    if p.rows.is_empty() {
        return Err("no rows to process".into());
    }
    if BATCH_ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("a batch is already running".into());
    }
    let run_id = format!("run-{}", NEXT_RUN.fetch_add(1, Ordering::SeqCst));
    let cancel = Arc::new(AtomicBool::new(false));
    cancels()
        .lock()
        .unwrap()
        .insert(run_id.clone(), cancel.clone());
    let _guard = BatchGuard(run_id.clone());

    let (mut cdp, _page) = connect_page(&p.session).await?;
    if !form::is_ready(&mut cdp, &p.session.settings).await? {
        return Err(
            "the page does not look logged in (create button not found) — sign in, then retry"
                .into(),
        );
    }

    let send = |v: Value| {
        let _ = tx.send(Response::event(id.to_string(), v));
    };
    send(json!({ "type": "started", "runId": run_id, "total": p.rows.len() }));

    let (mut ok, mut failed, mut cancelled, mut aborted) = (0usize, 0usize, false, false);
    for (index, row) in p.rows.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        send(json!({ "type": "row-start", "index": index, "serviceCode": row.service_code }));
        match form::run_row(&mut cdp, row, &p.session.settings).await {
            Ok(()) => {
                ok += 1;
                send(json!({ "type": "row-done", "index": index }));
            }
            Err(e) => {
                failed += 1;
                eprintln!("row {index} failed: {e}");
                send(json!({ "type": "row-error", "index": index, "error": e }));
                // Never fill the next row into a dialog left open by this one.
                if !form::wait_dialog_closed(&mut cdp, 3_000).await {
                    aborted = true;
                    send(json!({
                        "type": "aborted",
                        "index": index,
                        "error": "the form dialog is still open after the failure; close it by hand, then re-run the remaining rows"
                    }));
                    break;
                }
            }
        }
    }
    send(
        json!({ "type": "finished", "ok": ok, "failed": failed, "cancelled": cancelled, "aborted": aborted }),
    );
    Ok(())
}

fn cancel_batch(params: Value) -> Result<Value, String> {
    let p: CancelParams = parse(params)?;
    let found = cancels()
        .lock()
        .unwrap()
        .get(&p.run_id)
        .map(|f| f.store(true, Ordering::SeqCst))
        .is_some();
    Ok(json!({ "cancelled": found }))
}

async fn handle(req: Request, tx: Tx) {
    let Request {
        protocol,
        id,
        method,
        params,
    } = req;
    if protocol != SERVICE_PROTOCOL {
        let _ = tx.send(Response::err(
            id,
            format!("protocol mismatch: client {protocol}, sidecar {SERVICE_PROTOCOL}"),
        ));
        return;
    }
    let result = match method.as_str() {
        "launch-chrome" => launch_chrome(params).await,
        "session-status" => session_status(params).await,
        "parse-csv" => {
            parse::<CsvParams>(params).map(|p| json!(rows::parse_csv(&p.text, p.skip_header)))
        }
        "cancel-batch" => cancel_batch(params),
        "run-batch" => return run_batch(id, params, tx).await,
        other => Err(format!("unsupported method: \"{other}\"")),
    };
    let _ = tx.send(match result {
        Ok(v) => Response::once(id, v),
        Err(e) => Response::err(id, e),
    });
}

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<Response>();

    // One task owns stdout so concurrent responses never interleave mid-line.
    tokio::spawn(async move {
        let mut out = tokio::io::stdout();
        while let Some(resp) = rx.recv().await {
            let Ok(mut line) = serde_json::to_vec(&resp) else {
                continue;
            };
            line.push(b'\n');
            if out.write_all(&line).await.is_err() || out.flush().await.is_err() {
                break;
            }
        }
    });

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Request>(&line) {
            Ok(req) => {
                tokio::spawn(handle(req, tx.clone()));
            }
            // No trustworthy id when the JSON itself is broken.
            Err(e) => {
                let _ = tx.send(Response::err(String::new(), format!("invalid JSON: {e}")));
            }
        }
    }
    // stdin closed: the host is gone, so exit rather than linger.
}
