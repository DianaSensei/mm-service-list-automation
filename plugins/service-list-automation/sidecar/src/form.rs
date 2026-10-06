// The form-filling step, ported from the original Selenium `Main.java` and
// driven step by step from Rust so trusted (browser-level) input can be
// interleaved with page scripts.
//
// Per row: click "create" → wait for the dialog iframe → type into the text
// fields → pick the selects → tick the checkbox → click submit → wait for the
// dialog to close. Every step waits (polling) for its element instead of
// assuming it is there; in `trusted` input mode a click additionally waits
// until the element is actually hittable, like Selenium's native click.
//
// Differences from the Selenium version, all deliberate:
//   - dependent selects (L1 → L2 → … cascades) are *waited for*, not assumed
//     populated by the time the next one is touched;
//   - ids, constants, timeouts and matching rules are settings (`config.rs`),
//     since the ids are APEX-generated and the likeliest thing to change;
//   - a dry run fills everything but never submits.

use std::time::{Duration, Instant};

use serde_json::Value;

use crate::cdp::Cdp;
use crate::config::{InputMode, OptionMatch, RunSettings};
use crate::rows::ServiceRow;

/// Page-side helpers shared by every snippet.
const HELPERS: &str = r#"
const visible = (el) => {
  if (!el) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
};
const frameEl = () => document.querySelector('iframe');
const frameDoc = () => { try { const f = frameEl(); return f && f.contentDocument; } catch (e) { return null; } };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
"#;

fn expr(body: &str) -> String {
    format!("(() => {{ {HELPERS} {body} }})()")
}

fn js(s: &str) -> String {
    serde_json::to_string(s).expect("string serialises")
}

/// Which document an element lives in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Doc {
    Top,
    Frame,
}

/// JS expression yielding the element (or null).
fn el_expr(doc: Doc, id: &str) -> String {
    match doc {
        Doc::Top => format!("document.getElementById({})", js(id)),
        Doc::Frame => format!("(frameDoc() && frameDoc().getElementById({}))", js(id)),
    }
}

fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Poll `body` (a JS function body returning a value) until it is truthy.
async fn wait_until(
    cdp: &mut Cdp,
    body: &str,
    what: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let script = expr(body);
    let start = Instant::now();
    loop {
        let v = cdp.eval(&script).await?;
        if is_truthy(&v) {
            return Ok(v);
        }
        if start.elapsed() >= Duration::from_millis(timeout_ms) {
            return Err(format!("timed out waiting for {what}"));
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
}

/// Viewport coordinates of the element's centre, only once it is visible and
/// nothing covers that point (so a click would really land on it).
fn point_body(doc: Doc, id: &str) -> String {
    let el = el_expr(doc, id);
    let hit = match doc {
        Doc::Top => "document.elementFromPoint(x, y)".to_string(),
        Doc::Frame => "frameDoc().elementFromPoint(lx, ly)".to_string(),
    };
    let shift = match doc {
        Doc::Top => "",
        Doc::Frame => {
            "const f = frameEl(), fr = f.getBoundingClientRect(); const lx = x, ly = y; x += fr.left + f.clientLeft; y += fr.top + f.clientTop;"
        }
    };
    format!(
        "const el = {el}; if (!el || !visible(el)) return null; \
         el.scrollIntoView({{ block: 'center', inline: 'center' }}); \
         const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; \
         let x = r.left + r.width / 2, y = r.top + r.height / 2; {shift} \
         const hit = {hit}; if (!hit || !(hit === el || el.contains(hit))) return null; \
         return {{ x, y }};"
    )
}

async fn click(cdp: &mut Cdp, doc: Doc, id: &str, s: &RunSettings) -> Result<(), String> {
    let t = s.behavior.timeout_ms;
    match s.behavior.input_mode {
        InputMode::Trusted => {
            let p = wait_until(
                cdp,
                &point_body(doc, id),
                &format!("#{id} to be clickable"),
                t,
            )
            .await?;
            let (x, y) = (
                p["x"].as_f64().unwrap_or(0.0),
                p["y"].as_f64().unwrap_or(0.0),
            );
            cdp.mouse_click(x, y).await
        }
        InputMode::Script => {
            let body = format!(
                "const el = {}; if (!visible(el)) return false; el.click(); return true;",
                el_expr(doc, id)
            );
            wait_until(cdp, &body, &format!("#{id} to be visible"), t)
                .await
                .map(|_| ())
        }
    }
}

async fn type_text(cdp: &mut Cdp, id: &str, value: &str, s: &RunSettings) -> Result<(), String> {
    let t = s.behavior.timeout_ms;
    let el = el_expr(Doc::Frame, id);
    // Focus and select the current content so typing replaces it (Selenium's
    // clear() + sendKeys()).
    let focus = format!("const el = {el}; if (!el) return false; el.focus(); if (el.select) el.select(); return true;");
    wait_until(cdp, &focus, &format!("#{id}"), t).await?;

    if s.behavior.input_mode == InputMode::Trusted && !value.is_empty() {
        // Real typing: the browser fires `input`, and `change` when focus leaves.
        cdp.insert_text(value).await?;
        return cdp
            .eval(&expr(&format!("const el = {el}; el.blur(); return true;")))
            .await
            .map(|_| ());
    }
    // Script mode, or clearing a field: a programmatic value change raises no
    // native `change`, so raise `input` and `change` by hand.
    let set = format!(
        "const el = {el}; el.value = {}; const W = el.ownerDocument.defaultView; \
         el.dispatchEvent(new W.Event('input', {{ bubbles: true }})); \
         el.dispatchEvent(new W.Event('change', {{ bubbles: true }})); el.blur(); return true;",
        js(value)
    );
    cdp.eval(&expr(&set)).await.map(|_| ())
}

/// JS function body returning the index of the matching option, or -1.
fn find_option_body(id: &str, text: &str, mode: OptionMatch) -> String {
    let test = match mode {
        OptionMatch::Exact => "norm(o.text) === want",
        OptionMatch::IgnoreCase => "norm(o.text).toLowerCase() === want.toLowerCase()",
        OptionMatch::Contains => "norm(o.text).toLowerCase().includes(want.toLowerCase())",
    };
    format!(
        "const sel = {}; if (!sel) return null; const want = norm({}); \
         const i = [...sel.options].findIndex((o) => {test}); return i;",
        el_expr(Doc::Frame, id),
        js(text)
    )
}

async fn select_option(cdp: &mut Cdp, id: &str, text: &str, s: &RunSettings) -> Result<(), String> {
    let t = s.behavior.timeout_ms;
    let find = find_option_body(id, text, s.behavior.option_match);
    // `-1` is falsy-by-meaning but truthy-by-JSON, so wait on `>= 0` explicitly.
    let guarded =
        format!("const i = (() => {{ {find} }})(); return i !== null && i >= 0 ? i + 1 : 0;");
    if let Err(e) = wait_until(cdp, &guarded, &format!("option \"{text}\" in #{id}"), t).await {
        // Say what *was* there: usually the fastest way to spot a CSV/page mismatch.
        let list = format!(
            "const sel = {}; return sel ? [...sel.options].map((o) => norm(o.text)).filter(Boolean).slice(0, 8) : null;",
            el_expr(Doc::Frame, id)
        );
        if cdp.is_closed() {
            return Err(e); // the connection died; "options seen" would only mislead
        }
        let seen = cdp.eval(&expr(&list)).await.ok().filter(|v| !v.is_null());
        return Err(match seen {
            Some(v) => format!("{e} (options seen: {v})"),
            None => format!("{e} (select not found)"),
        });
    }
    let apply = format!(
        "const i = (() => {{ {find} }})(); const sel = {}; sel.selectedIndex = i; \
         const W = sel.ownerDocument.defaultView; sel.dispatchEvent(new W.Event('change', {{ bubbles: true }})); return true;",
        el_expr(Doc::Frame, id)
    );
    cdp.eval(&expr(&apply)).await.map(|_| ())
}

async fn dialog_closed(cdp: &mut Cdp) -> bool {
    matches!(
        cdp.eval(&expr(
            "return [...document.querySelectorAll('iframe')].every((f) => !visible(f));"
        ))
        .await,
        Ok(Value::Bool(true))
    )
}

/// Poll until no dialog iframe is visible. After a failed row this decides
/// whether the next row may run: filling a second row into a dialog that is
/// still open from the first would silently write wrong data.
pub async fn wait_dialog_closed(cdp: &mut Cdp, timeout_ms: u64) -> bool {
    let start = Instant::now();
    loop {
        if dialog_closed(cdp).await {
            return true;
        }
        if start.elapsed() >= Duration::from_millis(timeout_ms) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Wait at start for the page to finish loading and show the create button.
/// Fails with a message that names both causes: not loaded yet, or not signed in.
pub async fn wait_ready(cdp: &mut Cdp, s: &RunSettings) -> Result<(), String> {
    let body = format!(
        "return document.readyState === 'complete' && visible({});",
        el_expr(Doc::Top, &s.form.ids.create)
    );
    wait_until(cdp, &body, "the page to load", s.behavior.ready_timeout_ms)
        .await
        .map(|_| ())
        .map_err(|_| "the create button never appeared — the page may still be loading, or you are not signed in".to_string())
}

/// One-shot readiness probe for the status indicator (no waiting).
pub async fn is_ready(cdp: &mut Cdp, s: &RunSettings) -> Result<bool, String> {
    let v = cdp
        .eval(&expr(&format!(
            "return !!{};",
            el_expr(Doc::Top, &s.form.ids.create)
        )))
        .await?;
    Ok(v.as_bool().unwrap_or(false))
}

#[derive(Debug, PartialEq, Eq)]
pub enum RowOutcome {
    Submitted,
    /// Dry run: everything was filled, nothing submitted.
    Filled,
}

/// A one-line description of the page's state, attached to errors so a failure
/// can be diagnosed without having been watching the screen.
async fn page_snapshot(cdp: &mut Cdp, s: &RunSettings) -> String {
    let body = format!(
        "const f = [...document.querySelectorAll('iframe')]; \
         return `readyState=${{document.readyState}}, create button ${{visible({}) ? 'visible' : 'not visible'}}, \
         iframes=${{f.length}} (${{f.filter(visible).length}} visible)`;",
        el_expr(Doc::Top, &s.form.ids.create)
    );
    match cdp.eval(&expr(&body)).await {
        Ok(Value::String(v)) => v,
        _ => "page state unavailable".to_string(),
    }
}

/// Click "create" until the form dialog really opens.
///
/// A click can be lost — right after a submit APEX refreshes the page, and a click
/// during that refresh does nothing. A click that produced no dialog at all is
/// therefore repeated. A dialog that is merely slow (its iframe is already there)
/// is NOT clicked again, which would open a second one.
async fn open_dialog(cdp: &mut Cdp, s: &RunSettings) -> Result<(), String> {
    let t = s.behavior.timeout_ms;
    let marker = format!(
        "return !!{};",
        el_expr(Doc::Frame, &s.form.ids.service_code)
    );
    let attempts = s.behavior.create_attempts.max(1);
    for attempt in 1..=attempts {
        click(cdp, Doc::Top, &s.form.ids.create, s).await?;
        let last = attempt == attempts;
        let first_wait = if last {
            t
        } else {
            s.behavior.dialog_open_wait_ms.min(t)
        };
        if wait_until(cdp, &marker, "the form dialog", first_wait)
            .await
            .is_ok()
        {
            return Ok(());
        }
        let loading = matches!(
            cdp.eval(&expr(
                "return [...document.querySelectorAll('iframe')].some(visible);"
            ))
            .await,
            Ok(Value::Bool(true))
        );
        if loading {
            // The dialog is coming, just slowly: give it the whole step timeout.
            return match wait_until(cdp, &marker, "the form dialog", t).await {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("{e} ({})", page_snapshot(cdp, s).await)),
            };
        }
        if last {
            let tries = if attempts > 1 {
                format!(" after {attempts} clicks")
            } else {
                String::new()
            };
            return Err(format!(
                "timed out waiting for the form dialog{tries} ({})",
                page_snapshot(cdp, s).await
            ));
        }
    }
    unreachable!("the loop returns on its last attempt")
}

async fn fill_and_submit(
    cdp: &mut Cdp,
    row: &ServiceRow,
    s: &RunSettings,
) -> Result<RowOutcome, String> {
    let (i, c) = (&s.form.ids, &s.form.constants);
    let t = s.behavior.timeout_ms;

    open_dialog(cdp, s).await?;

    type_text(cdp, &i.service_code, &row.service_code, s).await?;
    type_text(cdp, &i.service_description, &row.service_description, s).await?;
    type_text(cdp, &i.merchant, &row.merchant_name, s).await?;

    // Same call order as the original — it matters for the cascading selects.
    let vertical = s.form.vertical_for(&row.l3);
    let selects: [(&str, &str); 9] = [
        (&i.l1, &c.l1),
        (&i.l2, &row.l2),
        (&i.l3, &row.l3),
        (&i.l4, &row.l4),
        (&i.l5, &c.l5),
        (&i.l6, &row.l6),
        (&i.group_code_l1, &c.group_code_l1),
        (&i.vertical, &vertical),
        (&i.project, &c.project),
    ];
    for (id, text) in selects {
        select_option(cdp, id, text, s).await?;
    }

    // 1 = present and unticked, 2 = present and ticked (0 = not there yet).
    let state_body = format!(
        "const el = {}; return el ? (el.checked ? 2 : 1) : 0;",
        el_expr(Doc::Frame, &i.check)
    );
    let state = wait_until(cdp, &state_body, &format!("#{}", i.check), t).await?;
    if state.as_i64() == Some(1) {
        click(cdp, Doc::Frame, &i.check, s).await?;
    }

    if s.behavior.dry_run {
        tokio::time::sleep(Duration::from_millis(s.behavior.dry_run_hold_ms)).await;
        cdp.press_escape().await?;
        return if wait_dialog_closed(cdp, s.behavior.close_timeout_ms).await {
            Ok(RowOutcome::Filled)
        } else {
            Err("dry run: the dialog did not close on Escape".to_string())
        };
    }

    click(cdp, Doc::Frame, &i.submit, s).await?;
    if wait_dialog_closed(cdp, s.behavior.close_timeout_ms).await {
        // The page refreshes after a submit; let it finish before the next row.
        tokio::time::sleep(Duration::from_millis(s.behavior.after_submit_settle_ms)).await;
        Ok(RowOutcome::Submitted)
    } else {
        Err("dialog did not close after submit (the form may have rejected the row)".to_string())
    }
}

/// Fill (and, unless dry-running, submit) one row. On any failure the dialog may
/// be left open, so Escape is pressed to leave the page usable for the next row.
pub async fn run_row(
    cdp: &mut Cdp,
    row: &ServiceRow,
    s: &RunSettings,
) -> Result<RowOutcome, String> {
    let result = fill_and_submit(cdp, row, s).await;
    if result.is_err() {
        let _ = cdp.press_escape().await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OptionMatch;

    #[test]
    fn ids_and_text_are_embedded_as_json_not_spliced_into_code() {
        let e = el_expr(Doc::Frame, "a\"b'c\\");
        assert!(e.contains(r#""a\"b'c\\""#), "{e}");
        let body = find_option_body("sel", "O'Brien \"Cafe\"\\", OptionMatch::Exact);
        assert!(body.contains(r#""O'Brien \"Cafe\"\\""#), "{body}");
    }

    #[test]
    fn option_matching_modes_pick_different_predicates() {
        assert!(find_option_body("s", "x", OptionMatch::Exact).contains("=== want"));
        assert!(find_option_body("s", "x", OptionMatch::IgnoreCase)
            .contains("toLowerCase() === want.toLowerCase()"));
        assert!(find_option_body("s", "x", OptionMatch::Contains).contains("includes("));
    }

    #[test]
    fn truthiness_matches_what_the_waiters_expect() {
        use serde_json::json;
        for falsy in [json!(null), json!(false), json!(0), json!("")] {
            assert!(!is_truthy(&falsy), "{falsy}");
        }
        for truthy in [json!(true), json!(1), json!("x"), json!({"x": 1})] {
            assert!(is_truthy(&truthy), "{truthy}");
        }
    }

    #[test]
    fn click_point_in_a_frame_is_translated_to_viewport_coordinates() {
        let top = point_body(Doc::Top, "b");
        let frame = point_body(Doc::Frame, "b");
        assert!(!top.contains("frameEl()"));
        assert!(frame.contains("fr.left + f.clientLeft"));
        assert!(frame.contains("frameDoc().elementFromPoint(lx, ly)"));
    }
}
