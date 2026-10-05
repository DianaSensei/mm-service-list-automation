// Locating and launching Chrome, and talking to its DevTools HTTP endpoint.
//
// Chrome is always started with a dedicated `--user-data-dir`: since Chrome
// 136 the remote-debugging switches are ignored on the default profile, and a
// separate profile also means the user's everyday Chrome is never locked or
// touched. The login lives in that profile, so it survives between runs.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub web_socket_debugger_url: Option<String>,
}

pub fn detect_chrome() -> Option<PathBuf> {
    candidates().into_iter().find(|p| p.is_file())
}

#[cfg(target_os = "macos")]
fn candidates() -> Vec<PathBuf> {
    [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

#[cfg(target_os = "windows")]
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let base = PathBuf::from(base);
            out.push(base.join(r"Google\Chrome\Application\chrome.exe"));
            out.push(base.join(r"Microsoft\Edge\Application\msedge.exe"));
        }
    }
    out
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn candidates() -> Vec<PathBuf> {
    let names = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
    ];
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .collect()
}

/// Arguments for a debuggable Chrome on `profile_dir`. Pure so it can be tested.
pub fn launch_args(port: u16, profile_dir: &Path, url: Option<&str>) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", profile_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    if let Some(url) = url.filter(|u| !u.is_empty()) {
        args.push(url.to_string());
    }
    args
}

pub fn spawn_chrome(chrome: &Path, args: &[String]) -> std::io::Result<u32> {
    let child = Command::new(chrome)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    // Deliberately not waited on or killed: Chrome belongs to the user's
    // session and must outlive this sidecar.
    Ok(child.id())
}

/// Minimal HTTP/1.1 GET against Chrome's local DevTools endpoint. It must be
/// 1.1: Chrome answers an HTTP/1.0 request with an empty reply. `Connection:
/// close` makes the reply end at EOF; Chrome sends `Content-Length`, never
/// chunked, so the body is everything after the header block.
async fn http_get(port: u16, path: &str) -> Result<String, String> {
    let fut = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .map_err(|e| e.to_string())?;
        let req =
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
        stream
            .write_all(req.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        // Chrome may keep the socket open after replying, so stop at
        // `Content-Length` rather than waiting for EOF.
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            if let Some(done) = response_complete(&buf) {
                if done {
                    break;
                }
            }
            let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let text = String::from_utf8_lossy(&buf).into_owned();
        match text.split_once("\r\n\r\n") {
            Some((head, body)) if head.starts_with("HTTP/1.") && head.contains(" 200") => {
                Ok(body.to_string())
            }
            Some((head, _)) => Err(format!(
                "unexpected response: {}",
                head.lines().next().unwrap_or("")
            )),
            None => Err("malformed HTTP response".to_string()),
        }
    };
    tokio::time::timeout(Duration::from_secs(3), fut)
        .await
        .map_err(|_| "timed out".to_string())?
}

/// `Some(true)` once the header block and `Content-Length` bytes of body have
/// arrived, `Some(false)` while the body is still short, `None` before the
/// headers are complete (or when there is no length, so only EOF ends it).
fn response_complete(buf: &[u8]) -> Option<bool> {
    let text = std::str::from_utf8(buf).ok()?;
    let (head, body) = text.split_once("\r\n\r\n")?;
    let len: usize = head
        .lines()
        .find_map(|l| {
            l.split_once(':')
                .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        })
        .and_then(|(_, v)| v.trim().parse().ok())?;
    Some(body.len() >= len)
}

pub async fn is_reachable(port: u16) -> bool {
    http_get(port, "/json/version").await.is_ok()
}

/// The browser-level websocket (not a tab), for window management:
/// `Target.createTarget`, `Target.activateTarget`, `Browser.close`.
pub async fn browser_ws_url(port: u16) -> Result<String, String> {
    let body = http_get(port, "/json/version").await?;
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("bad /json/version payload: {e}"))?;
    v.get("webSocketDebuggerUrl")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Chrome did not report a browser websocket".to_string())
}

/// Real windows' tabs only: not service workers, extension pages or the like.
pub async fn list_pages(port: u16) -> Result<Vec<Target>, String> {
    Ok(list_targets(port)
        .await?
        .into_iter()
        .filter(|t| t.kind == "page")
        .collect())
}

pub async fn list_targets(port: u16) -> Result<Vec<Target>, String> {
    let body = http_get(port, "/json").await?;
    serde_json::from_str(&body).map_err(|e| format!("bad /json payload: {e}"))
}

/// First debuggable page whose URL contains `url_contains` (any page if empty).
pub fn pick_page(targets: &[Target], url_contains: &str) -> Option<Target> {
    targets
        .iter()
        .find(|t| {
            t.kind == "page" && t.web_socket_debugger_url.is_some() && t.url.contains(url_contains)
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serves one canned reply, but — like Chrome — says nothing to HTTP/1.0.
    async fn fake_devtools(reply_body: &'static str) -> u16 {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                if String::from_utf8_lossy(&buf[..n]).starts_with("GET /json HTTP/1.1\r\n") {
                    let msg = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length:{}\r\nContent-Type:application/json\r\n\r\n{reply_body}",
                        reply_body.len()
                    );
                    let _ = sock.write_all(msg.as_bytes()).await;
                }
            }
        });
        port
    }

    #[tokio::test]
    async fn lists_targets_over_http_1_1() {
        let port = fake_devtools(
            r#"[{"type":"page","title":"T","url":"https://app/","webSocketDebuggerUrl":"ws://127.0.0.1:1/devtools/page/x"}]"#,
        )
        .await;
        let ts = list_targets(port).await.unwrap();
        assert_eq!(ts.len(), 1);
        assert_eq!(ts[0].title, "T");
        assert!(pick_page(&ts, "app").is_some());
    }

    #[tokio::test]
    async fn closed_port_is_simply_not_reachable() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(!is_reachable(port).await);
    }

    fn target(kind: &str, url: &str, ws: bool) -> Target {
        Target {
            id: String::new(),
            kind: kind.into(),
            title: String::new(),
            url: url.into(),
            web_socket_debugger_url: ws.then(|| "ws://127.0.0.1:1/devtools/page/x".to_string()),
        }
    }

    #[test]
    fn launch_args_always_set_a_profile_and_port() {
        let args = launch_args(9222, Path::new("/p"), Some("https://example.com"));
        assert!(args.contains(&"--remote-debugging-port=9222".to_string()));
        assert!(args.contains(&"--user-data-dir=/p".to_string()));
        assert_eq!(args.last().unwrap(), "https://example.com");
        assert_eq!(launch_args(9222, Path::new("/p"), Some("")).len(), 4);
    }

    #[test]
    fn pick_page_skips_non_pages_and_filters_by_url() {
        let ts = vec![
            target("service_worker", "https://app/sw.js", true),
            target("page", "https://other/", true),
            target("page", "https://app/f?p=1", false),
            target("page", "https://app/f?p=2", true),
        ];
        assert_eq!(pick_page(&ts, "app/").unwrap().url, "https://app/f?p=2");
        assert_eq!(pick_page(&ts, "").unwrap().url, "https://other/");
        assert!(pick_page(&ts, "nomatch").is_none());
    }
}
