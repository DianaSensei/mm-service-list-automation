// A deliberately small Chrome DevTools Protocol client: one websocket to one
// page target, strictly request → response. Events Chrome pushes in between
// are skipped, which is all `Runtime.evaluate`/`Input.dispatchKeyEvent` need.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub struct Cdp {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Cdp {
    pub async fn connect(ws_url: &str) -> Result<Self, String> {
        let (ws, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .map_err(|e| format!("CDP connect failed: {e}"))?;
        Ok(Self { ws, next_id: 0 })
    }

    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let frame = json!({ "id": id, "method": method, "params": params }).to_string();
        self.ws
            .send(Message::text(frame))
            .await
            .map_err(|e| format!("CDP send failed: {e}"))?;

        while let Some(msg) = self.ws.next().await {
            let msg = msg.map_err(|e| format!("CDP read failed: {e}"))?;
            let Message::Text(text) = msg else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if v.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(err) = v.get("error") {
                return Err(format!(
                    "{method}: {}",
                    err.get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("error")
                ));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
        Err("CDP connection closed".to_string())
    }

    /// Evaluate `expression` (awaiting a returned promise) and return its JSON
    /// value. A thrown error in the page comes back as `Err(message)`.
    pub async fn eval(&mut self, expression: &str) -> Result<Value, String> {
        let res = self
            .call(
                "Runtime.evaluate",
                json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
            )
            .await?;
        if let Some(ex) = res.get("exceptionDetails") {
            let msg = ex
                .pointer("/exception/description")
                .or_else(|| ex.pointer("/exception/value"))
                .or_else(|| ex.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("script error");
            return Err(first_line(msg));
        }
        Ok(res.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    pub async fn press_escape(&mut self) -> Result<(), String> {
        for kind in ["keyDown", "keyUp"] {
            self.call(
                "Input.dispatchKeyEvent",
                json!({ "type": kind, "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27 }),
            )
            .await?;
        }
        Ok(())
    }
}

fn first_line(s: &str) -> String {
    s.lines()
        .next()
        .unwrap_or(s)
        .trim()
        .trim_start_matches("Error: ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::first_line;

    #[test]
    fn trims_stack_traces_to_the_message() {
        assert_eq!(
            first_line("Error: option \"X\" not found\n    at <anonymous>:1:1"),
            "option \"X\" not found"
        );
    }
}
