// Every tunable of the run, with defaults read from `defaults.json` at the
// plugin root. That file is the single source of truth: the UI imports the same
// JSON, so "reset to defaults" in the settings screen and the sidecar's own
// fallbacks can never drift apart.
//
// Any field left out of a request falls back to its default, so a caller (or an
// older saved UI state) may send only what it wants to change: requests enter
// through `settings_from` / `columns_from`.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

// Why strict types + a JSON merge instead of `#[serde(default)]`: serde builds
// `Default::default()` eagerly when it starts a struct with a container-level
// default, and here `Default` reads `defaults.json` — whose own parse would then
// re-enter itself (a deadlock inside the `OnceLock`). So the structs below are
// strict (every field required) and the request is laid over the defaults as
// JSON *before* it is deserialised.

fn defaults_value() -> &'static Value {
    static D: OnceLock<Value> = OnceLock::new();
    D.get_or_init(|| {
        serde_json::from_str(include_str!("../../defaults.json"))
            .expect("defaults.json is valid JSON")
    })
}

/// `over` laid on top of `base`: objects merge key by key, anything else in
/// `over` replaces, and `null` means "not given".
fn merge(base: &Value, over: &Value) -> Value {
    match (base, over) {
        (_, Value::Null) => base.clone(),
        (Value::Object(b), Value::Object(o)) => {
            let mut out = b.clone();
            for (k, v) in o {
                let merged = match b.get(k) {
                    Some(bv) => merge(bv, v),
                    None => v.clone(),
                };
                out.insert(k.clone(), merged);
            }
            Value::Object(out)
        }
        (_, o) => o.clone(),
    }
}

/// Deserialise `over` laid on the defaults found at `path` in `defaults.json`.
fn overlay<T: for<'de> Deserialize<'de>>(path: &[&str], over: Value) -> Result<T, String> {
    let mut base = defaults_value();
    for key in path {
        base = base
            .get(*key)
            .ok_or_else(|| format!("defaults.json has no \"{key}\""))?;
    }
    serde_json::from_value(merge(base, &over)).map_err(|e| format!("invalid settings: {e}"))
}

fn from_defaults<T: for<'de> Deserialize<'de>>(path: &[&str]) -> T {
    overlay(path, Value::Null)
        .unwrap_or_else(|e| panic!("defaults.json does not match its schema: {e}"))
}

macro_rules! default_from {
    ($t:ty, $($path:expr),*) => {
        impl Default for $t {
            fn default() -> Self {
                from_defaults(&[$($path),*])
            }
        }
    };
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Columns {
    pub mid: usize,
    pub service_code: usize,
    pub service_description: usize,
    pub merchant_name: usize,
    pub l2: usize,
    pub l3: usize,
    pub l4: usize,
    pub l6: usize,
}
default_from!(Columns, "csv", "columns");

impl Columns {
    /// Smallest column count a row needs to contain every mapped field.
    pub fn min_len(&self) -> usize {
        [
            self.mid,
            self.service_code,
            self.service_description,
            self.merchant_name,
            self.l2,
            self.l3,
            self.l4,
            self.l6,
        ]
        .into_iter()
        .max()
        .unwrap_or(0)
            + 1
    }
}

/// A request's `columns` laid over the defaults.
pub fn columns_from(over: Value) -> Result<Columns, String> {
    overlay(&["csv", "columns"], over)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Constants {
    pub l1: String,
    pub l5: String,
    pub group_code_l1: String,
    pub project: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormConfig {
    pub constants: Constants,
    /// L3 value (case-insensitive) → the vertical to select instead of L3 itself.
    pub vertical_overrides: BTreeMap<String, String>,
    pub ids: ElementIds,
}

impl FormConfig {
    /// The vertical for a row: an override if one matches L3, else L3 itself.
    pub fn vertical_for(&self, l3: &str) -> String {
        self.vertical_overrides
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(l3))
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| l3.to_string())
    }
}

/// How text and clicks reach the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputMode {
    /// Browser-level input over CDP (real, trusted events — closest to Selenium).
    Trusted,
    /// Plain script: set `.value` and call `.click()`. Fallback when a page
    /// rejects or mis-handles the trusted path.
    Script,
}

/// How an option's visible text is matched against the CSV value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OptionMatch {
    Exact,
    IgnoreCase,
    Contains,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Behavior {
    /// Per-step wait for an element / option / dialog to appear.
    pub timeout_ms: u64,
    /// How long to wait for the dialog to close after submit.
    pub close_timeout_ms: u64,
    /// How long to wait at start for the page to finish loading.
    pub ready_timeout_ms: u64,
    pub input_mode: InputMode,
    pub option_match: OptionMatch,
    /// Stop the batch after this many failed rows in a row (0 = never).
    pub max_consecutive_failures: u32,
    /// Fill every field but do not submit. Defaults to true: a request that does
    /// not say otherwise never writes anything.
    pub dry_run: bool,
    /// Pause after each successful submit, so the page can finish refreshing
    /// before the next "create" click.
    pub after_submit_settle_ms: u64,
    /// How long one "create" click may go without any dialog appearing before it
    /// is judged lost and clicked again.
    pub dialog_open_wait_ms: u64,
    /// Total "create" clicks to try per row (1 = no retry).
    pub create_attempts: u32,
    /// Bring the Chrome window to the front once, when a run starts, so it can be
    /// watched. Never again during the run: the user may switch away freely (the
    /// input the tool sends does not need the window to be in front).
    pub bring_to_front_on_start: bool,
    /// In a dry run, how long the filled dialog stays visible before it is closed.
    pub dry_run_hold_ms: u64,
}

/// What to do when a row turns out to be a duplicate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnDuplicate {
    /// Record it, leave it alone, carry on with the next row.
    Skip,
    /// Stop the whole batch.
    Stop,
}

/// How the result of a submit is read back from the page. The tool never sees the
/// server's answer directly, only what the page shows, so this is configurable
/// markup (APEX Universal Theme by default) plus a text pattern for "duplicate".
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// CSS selectors of a success notice (comma separated).
    pub success_selectors: String,
    /// CSS selectors of an error / validation notice (comma separated).
    pub error_selectors: String,
    /// Case-insensitive regular expression: an error notice matching it means "duplicate".
    pub duplicate_pattern: String,
    pub on_duplicate: OnDuplicate,
    /// Skip a row whose service code already appeared earlier in the same file,
    /// without touching the page.
    pub skip_file_duplicates: bool,
    /// After the dialog closes, how long to look for a success or error notice.
    pub confirm_wait_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunSettings {
    pub form: FormConfig,
    pub behavior: Behavior,
    pub outcome: Outcome,
}
default_from!(RunSettings,);

/// A request's `settings` laid over the defaults.
pub fn settings_from(over: Value) -> Result<RunSettings, String> {
    overlay(&[], over)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_json_matches_every_type() {
        // Loud, early failure if defaults.json and the structs disagree.
        let _ = RunSettings::default();
        let _ = Columns::default();
        let _: Value = defaults_value().clone();
    }

    #[test]
    fn defaults_match_the_current_template_and_form() {
        let s = RunSettings::default();
        assert_eq!(s.form.constants.l1, "SME OFFLINE");
        assert_eq!(s.form.ids.create, "B71233594014006408");
        assert_eq!(s.form.vertical_for("grocery"), "GROCERY - OTHER");
        assert_eq!(s.form.vertical_for("FASHION"), "FASHION");
        let c = Columns::default();
        // The 9-column template: MID, code, description, merchant, CATEGORY, L2, L3, L4, L6.
        assert_eq!((c.service_code, c.l2, c.l3, c.l4, c.l6), (1, 5, 6, 7, 8));
        assert_eq!(c.min_len(), 9);
    }

    #[test]
    fn a_partial_request_only_overrides_what_it_names() {
        let s = settings_from(json!({
            "form": { "ids": { "submit": "S" }, "constants": { "l1": "X" } },
            "behavior": { "timeoutMs": 500, "inputMode": "script", "optionMatch": "contains" }
        }))
        .unwrap();
        assert_eq!(s.form.ids.submit, "S");
        assert_eq!(s.form.ids.create, "B71233594014006408");
        assert_eq!(s.form.constants.l1, "X");
        assert_eq!(s.form.constants.l5, "OTHER");
        assert_eq!(s.behavior.timeout_ms, 500);
        assert_eq!(s.behavior.input_mode, InputMode::Script);
        assert_eq!(s.behavior.option_match, OptionMatch::Contains);
        assert_eq!(s.behavior.close_timeout_ms, 10_000);
    }

    #[test]
    fn outcome_defaults_look_for_apex_notices_and_skip_duplicates() {
        let o = RunSettings::default().outcome;
        assert!(o.success_selectors.contains(".t-Alert--success"));
        assert!(o.error_selectors.contains(".t-Alert--danger"));
        assert_eq!(o.on_duplicate, OnDuplicate::Skip);
        assert!(o.skip_file_duplicates);
        let stop = settings_from(json!({ "outcome": { "onDuplicate": "stop" } }))
            .unwrap()
            .outcome;
        assert_eq!(stop.on_duplicate, OnDuplicate::Stop);
        assert_eq!(stop.confirm_wait_ms, 3000);
    }

    #[test]
    fn a_request_that_does_not_mention_dry_run_is_a_dry_run() {
        // The safe default: nothing is submitted unless a caller says so, explicitly.
        assert!(settings_from(Value::Null).unwrap().behavior.dry_run);
        assert!(
            settings_from(json!({ "behavior": { "timeoutMs": 5 } }))
                .unwrap()
                .behavior
                .dry_run
        );
        assert!(
            !settings_from(json!({ "behavior": { "dryRun": false } }))
                .unwrap()
                .behavior
                .dry_run
        );
    }

    #[test]
    fn missing_or_null_settings_mean_all_defaults() {
        assert_eq!(
            settings_from(Value::Null).unwrap().behavior.timeout_ms,
            10_000
        );
        assert_eq!(
            settings_from(json!({})).unwrap().form.ids.submit,
            "B71221230860006389"
        );
    }

    #[test]
    fn a_wrong_type_is_reported_not_silently_defaulted() {
        let err = settings_from(json!({ "behavior": { "timeoutMs": "soon" } })).unwrap_err();
        assert!(err.contains("invalid settings"), "{err}");
        assert!(settings_from(json!({ "behavior": { "inputMode": "telepathy" } })).is_err());
    }

    #[test]
    fn vertical_overrides_are_replaced_as_a_whole_map_merge_is_per_key() {
        // Per-key merge: adding an override keeps the default GROCERY one.
        let s =
            settings_from(json!({ "form": { "verticalOverrides": { "KIDS": "KIDS - OTHER" } } }))
                .unwrap();
        assert_eq!(s.form.vertical_for("kids"), "KIDS - OTHER");
        assert_eq!(s.form.vertical_for("grocery"), "GROCERY - OTHER");
    }

    #[test]
    fn min_len_follows_the_mapping() {
        let c = columns_from(json!({ "l6": 14 })).unwrap();
        assert_eq!(c.min_len(), 15);
    }
}
