// The form-filling step, ported from the original Selenium `Main.java`. Each
// row is one `Runtime.evaluate` of a self-contained async script that runs in
// the page: click "create", wait for the dialog iframe, fill it, submit, wait
// for the iframe to go away.
//
// Differences from the Selenium version, both deliberate:
//   - dependent selects (L1 → L2 → … cascades) are *waited for* instead of
//     assumed to be populated by the time the next `Select` is built;
//   - the element ids are settings with the original values as defaults, since
//     they are APEX-generated and the likeliest thing to change.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::cdp::Cdp;
use crate::rows::ServiceRow;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ElementIds {
    pub create: String,
    pub service_code: String,
    pub service_description: String,
    pub merchant: String,
    pub l1: String,
    pub l2: String,
    pub l3: String,
    pub l4: String,
    pub l5: String,
    pub l6: String,
    pub group_code_l1: String,
    pub vertical: String,
    pub project: String,
    pub check: String,
    pub submit: String,
}

impl Default for ElementIds {
    fn default() -> Self {
        Self {
            create: "B71233594014006408".into(),
            service_code: "P7_SERVICE_CODE_input".into(),
            service_description: "P7_SERVICE_DESCRIPTION_input".into(),
            merchant: "P7_MERCHANT_input".into(),
            l1: "P7_BU_GROUP_CODE_L1_ID".into(),
            l2: "P7_BU_GROUP_CODE_L2_ID".into(),
            l3: "P7_BU_GROUP_CODE_L3_ID".into(),
            l4: "P7_BU_GROUP_CODE_L4_ID".into(),
            l5: "P7_BU_GROUP_CODE_L5_ID".into(),
            l6: "P7_BU_GROUP_CODE_L6_ID".into(),
            group_code_l1: "P7_GROUP_CODE_L1_ID".into(),
            vertical: "P7_NEWVERTICAL_ID".into(),
            project: "P7_SPECIALPROJECT_ID".into(),
            check: "P7_CHECK".into(),
            submit: "B71221230860006389".into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FormSettings {
    pub ids: ElementIds,
    /// Constant selections the original hardcoded.
    pub l1: String,
    pub l5: String,
    pub group_code_l1: String,
    pub project: String,
    /// Per-step wait (ms) for elements/options to appear.
    pub timeout_ms: u64,
    /// How long to wait for the dialog to close after submit.
    pub close_timeout_ms: u64,
}

impl Default for FormSettings {
    fn default() -> Self {
        Self {
            ids: ElementIds::default(),
            l1: "SME OFFLINE".into(),
            l5: "OTHER".into(),
            group_code_l1: "PAYMENT".into(),
            project: "SME OFFLINE".into(),
            timeout_ms: 10_000,
            close_timeout_ms: 10_000,
        }
    }
}

/// `GROCERY` has its own vertical; every other L3 is its own vertical.
fn vertical_for(l3: &str) -> String {
    if l3.eq_ignore_ascii_case("GROCERY") {
        "GROCERY - OTHER".to_string()
    } else {
        l3.to_string()
    }
}

/// Everything the in-page script needs, as data. Select order matches the
/// original's call order, which matters for the cascading dropdowns.
fn payload(row: &ServiceRow, s: &FormSettings) -> Value {
    let i = &s.ids;
    json!({
        "timeoutMs": s.timeout_ms,
        "closeTimeoutMs": s.close_timeout_ms,
        "create": i.create,
        "marker": i.service_code,
        "check": i.check,
        "submit": i.submit,
        "texts": [
            [i.service_code, row.service_code],
            [i.service_description, row.service_description],
            [i.merchant, row.merchant_name],
        ],
        "selects": [
            [i.l1, s.l1],
            [i.l2, row.l2],
            [i.l3, row.l3],
            [i.l4, row.l4],
            [i.l5, s.l5],
            [i.l6, row.l6],
            [i.group_code_l1, s.group_code_l1],
            [i.vertical, vertical_for(&row.l3)],
            [i.project, s.project],
        ],
    })
}

const SCRIPT: &str = r#"(async (p) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, what, ms = p.timeoutMs) => {
    const t = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t > ms) throw new Error('timed out waiting for ' + what);
      await sleep(100);
    }
  };
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  const create = await waitFor(() => { const e = document.getElementById(p.create); return visible(e) && e; }, 'create button');
  create.click();

  const frame = await waitFor(() => {
    const f = document.querySelector('iframe');
    return f && f.contentDocument && f.contentDocument.getElementById(p.marker) && f;
  }, 'form dialog');
  const d = frame.contentDocument;
  const w = frame.contentWindow;
  const $ = (id) => d.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

  const setText = async (id, value) => {
    const el = await waitFor(() => $(id), '#' + id);
    el.focus();
    el.value = '';
    el.value = value;
    fire(el, 'input');
    fire(el, 'change');
  };
  const selectText = async (id, text) => {
    const sel = await waitFor(() => $(id), '#' + id);
    const find = () => [...sel.options].findIndex((o) => norm(o.text) === norm(text));
    await waitFor(() => find() >= 0, 'option "' + text + '" in #' + id);
    sel.selectedIndex = find();
    fire(sel, 'change');
  };

  for (const [id, v] of p.texts) await setText(id, v);
  for (const [id, v] of p.selects) await selectText(id, v);

  const cb = await waitFor(() => $(p.check), '#' + p.check);
  if (!cb.checked) cb.click();
  (await waitFor(() => $(p.submit), '#' + p.submit)).click();

  const closed = await waitFor(
    () => [...document.querySelectorAll('iframe')].every((f) => !visible(f)),
    'dialog to close',
    p.closeTimeoutMs,
  ).then(() => true, () => false);
  return { closed };
})"#;

pub fn build_script(row: &ServiceRow, s: &FormSettings) -> String {
    format!("{SCRIPT}({})", payload(row, s))
}

/// Is the session on the page where the create button exists (i.e. logged in)?
pub async fn is_ready(cdp: &mut Cdp, s: &FormSettings) -> Result<bool, String> {
    let id = serde_json::to_string(&s.ids.create).map_err(|e| e.to_string())?;
    let v = cdp
        .eval(&format!("!!document.getElementById({id})"))
        .await?;
    Ok(v.as_bool().unwrap_or(false))
}

/// Poll until no dialog iframe is visible. After a failed row this is what
/// decides whether the next row may run: filling a second row into a dialog
/// that is still open from the first would silently write wrong data.
pub async fn wait_dialog_closed(cdp: &mut Cdp, timeout_ms: u64) -> bool {
    const CHECK: &str =
        "[...document.querySelectorAll('iframe')].every((f) => f.getClientRects().length === 0)";
    let mut waited = 0;
    loop {
        if matches!(cdp.eval(CHECK).await, Ok(Value::Bool(true))) {
            return true;
        }
        if waited >= timeout_ms {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        waited += 200;
    }
}

/// Fill and submit one row. On any failure the dialog may be left open, so
/// Escape is pressed to leave the page usable for the next row.
pub async fn run_row(cdp: &mut Cdp, row: &ServiceRow, s: &FormSettings) -> Result<(), String> {
    let outcome = cdp.eval(&build_script(row, s)).await;
    let result = match outcome {
        Ok(v) if v.get("closed").and_then(Value::as_bool) == Some(true) => return Ok(()),
        Ok(_) => Err(
            "dialog did not close after submit (the form may have rejected the row)".to_string(),
        ),
        Err(e) => Err(e),
    };
    let _ = cdp.press_escape().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(l3: &str) -> ServiceRow {
        ServiceRow {
            mid: "M".into(),
            service_code: "SC".into(),
            service_description: "D".into(),
            merchant_name: "N".into(),
            l2: "L2".into(),
            l3: l3.into(),
            l4: "L4".into(),
            l6: "L6".into(),
        }
    }

    #[test]
    fn grocery_maps_to_its_own_vertical_others_pass_through() {
        assert_eq!(vertical_for("grocery"), "GROCERY - OTHER");
        assert_eq!(vertical_for("FASHION"), "FASHION");
    }

    #[test]
    fn selects_keep_the_original_order() {
        let p = payload(&row("FASHION"), &FormSettings::default());
        let ids: Vec<&str> = p["selects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s[0].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            [
                "P7_BU_GROUP_CODE_L1_ID",
                "P7_BU_GROUP_CODE_L2_ID",
                "P7_BU_GROUP_CODE_L3_ID",
                "P7_BU_GROUP_CODE_L4_ID",
                "P7_BU_GROUP_CODE_L5_ID",
                "P7_BU_GROUP_CODE_L6_ID",
                "P7_GROUP_CODE_L1_ID",
                "P7_NEWVERTICAL_ID",
                "P7_SPECIALPROJECT_ID",
            ]
        );
        assert_eq!(p["selects"][7][1], "FASHION");
        assert_eq!(p["selects"][0][1], "SME OFFLINE");
    }

    #[test]
    fn row_values_are_embedded_as_json_not_spliced_into_code() {
        let mut r = row("X");
        r.merchant_name = "O'Brien \"Cafe\"\\".into();
        let script = build_script(&r, &FormSettings::default());
        assert!(
            script.ends_with("})"),
            "script must end with the call's closing paren"
        );
        assert!(script.contains(r#""O'Brien \"Cafe\"\\""#));
    }

    #[test]
    fn settings_deserialize_with_partial_overrides() {
        let s: FormSettings =
            serde_json::from_value(json!({ "l1": "X", "ids": { "submit": "S" } })).unwrap();
        assert_eq!(s.l1, "X");
        assert_eq!(s.ids.submit, "S");
        assert_eq!(s.ids.create, "B71233594014006408");
        assert_eq!(s.timeout_ms, 10_000);
    }
}
