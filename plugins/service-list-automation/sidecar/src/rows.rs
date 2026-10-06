// CSV → `ServiceRow`.
//
// Which column holds which field is decided in this order:
//   1. the header row, by name ("BU Group code L2 (…)" → L2) when `auto_detect`
//      is on and the file has a header — so a re-ordered or extended template
//      still maps correctly;
//   2. the configured column numbers (`config::Columns`) for any field the
//      header does not name, or when there is no header.
// The mapping actually used is returned with the rows, so the UI can show it to
// the user to verify before anything is written anywhere.

use serde::{Deserialize, Serialize};

use crate::config::Columns;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRow {
    pub mid: String,
    pub service_code: String,
    pub service_description: String,
    pub merchant_name: String,
    pub l2: String,
    pub l3: String,
    pub l4: String,
    pub l6: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    /// 1-based line number in the source text.
    pub line: u64,
    pub error: String,
}

/// One field of `ServiceRow` and where its value came from.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MappingEntry {
    /// camelCase field name, as in `ServiceRow`.
    pub field: &'static str,
    /// 1-based column number.
    pub column: usize,
    /// The header text of that column, if the file has a header.
    pub header: Option<String>,
    /// Found by header name (true) or taken from the configured column (false).
    pub detected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCsv {
    pub rows: Vec<ServiceRow>,
    pub errors: Vec<RowError>,
    pub mapping: Vec<MappingEntry>,
    /// Every header cell (whitespace collapsed), so the UI can point out the
    /// columns that no field uses. Empty when the file has no header.
    pub header: Vec<String>,
}

const FIELDS: [&str; 8] = [
    "mid",
    "serviceCode",
    "serviceDescription",
    "merchantName",
    "l2",
    "l3",
    "l4",
    "l6",
];

fn normalize(header: &str) -> String {
    header
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Which field a header cell names, if any.
fn field_of(header: &str) -> Option<&'static str> {
    let h = normalize(header);
    // "MID" must be the whole word, not the start of "MIDDLE" or similar.
    if h == "mid"
        || h.strip_prefix("mid")
            .is_some_and(|r| r.starts_with(|c: char| !c.is_alphanumeric()))
    {
        return Some("mid");
    }
    let has = |s: &str| h.contains(s);
    if has("service_description") || has("service description") {
        return Some("serviceDescription");
    }
    if has("service_code") || has("service code") {
        return Some("serviceCode");
    }
    if h.starts_with("merchant") {
        return Some("merchantName");
    }
    for (needle, field) in [
        ("code l2", "l2"),
        ("code l3", "l3"),
        ("code l4", "l4"),
        ("code l6", "l6"),
    ] {
        if has(needle) {
            return Some(field);
        }
    }
    None
}

fn index_of(columns: &Columns, field: &str) -> usize {
    match field {
        "mid" => columns.mid,
        "serviceCode" => columns.service_code,
        "serviceDescription" => columns.service_description,
        "merchantName" => columns.merchant_name,
        "l2" => columns.l2,
        "l3" => columns.l3,
        "l4" => columns.l4,
        _ => columns.l6,
    }
}

/// The mapping to use: header names first, configured columns for the rest.
fn resolve_mapping(
    header: Option<&[String]>,
    configured: &Columns,
    auto_detect: bool,
) -> (Columns, Vec<MappingEntry>) {
    let mut columns = configured.clone();
    let mut entries = Vec::new();
    for field in FIELDS {
        let found = header
            .filter(|_| auto_detect)
            .and_then(|h| h.iter().position(|cell| field_of(cell) == Some(field)));
        let (index, detected) = match found {
            Some(i) => (i, true),
            None => (index_of(configured, field), false),
        };
        match field {
            "mid" => columns.mid = index,
            "serviceCode" => columns.service_code = index,
            "serviceDescription" => columns.service_description = index,
            "merchantName" => columns.merchant_name = index,
            "l2" => columns.l2 = index,
            "l3" => columns.l3 = index,
            "l4" => columns.l4 = index,
            _ => columns.l6 = index,
        }
        entries.push(MappingEntry {
            field,
            column: index + 1,
            header: header
                .and_then(|h| h.get(index))
                .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" ")),
            detected,
        });
    }
    (columns, entries)
}

pub fn parse_csv(
    text: &str,
    skip_header: bool,
    configured: &Columns,
    auto_detect: bool,
) -> ParsedCsv {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(skip_header)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());

    let header: Option<Vec<String>> = if skip_header {
        reader
            .headers()
            .ok()
            .map(|r| r.iter().map(str::to_string).collect())
    } else {
        None
    };
    let (columns, mapping) = resolve_mapping(header.as_deref(), configured, auto_detect);
    let min_columns = columns.min_len();

    let mut rows = Vec::new();
    let mut errors = Vec::new();
    for record in reader.records() {
        let record = match record {
            Ok(r) => r,
            Err(e) => {
                errors.push(RowError {
                    line: e.position().map_or(0, |p| p.line()),
                    error: e.to_string(),
                });
                continue;
            }
        };
        let line = record.position().map_or(0, |p| p.line());
        if record.iter().all(str::is_empty) {
            continue;
        }
        if record.len() < min_columns {
            errors.push(RowError {
                line,
                error: format!(
                    "expected at least {min_columns} columns, found {}",
                    record.len()
                ),
            });
            continue;
        }
        let col = |i: usize| record.get(i).unwrap_or_default().to_string();
        rows.push(ServiceRow {
            mid: col(columns.mid),
            service_code: col(columns.service_code),
            service_description: col(columns.service_description),
            merchant_name: col(columns.merchant_name),
            l2: col(columns.l2),
            l3: col(columns.l3),
            l4: col(columns.l4),
            l6: col(columns.l6),
        });
    }
    let header = header
        .unwrap_or_default()
        .iter()
        .map(|c| c.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    ParsedCsv {
        rows,
        errors,
        mapping,
        header,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{columns_from, Columns};
    use serde_json::json;

    /// The header of the real template (made-up rows): multi-line quoted cells,
    /// an unbalanced "(" and a non-ASCII word.
    const TEMPLATE: &str = "MID,\"SERVICE_CODE\n(agent)\",SERVICE_DESCRIPTION_ (Tên Brand - [Tên pháp nhân (viết tắt)] - Chi nhánh - [HTTT chi tiết - WEB/APP/MINIAPP/OFFLINE]),MERCHANT (Brand Name),CATEGORY,BU Group code L2 (Group category/Industry,BU Group code L3 (Category),BU Group code L4 (Sub-category),\"BU Group code L6\nMặt bằng?\"\r\nM1,sc1,Desc,Merchant,Cat,FNB,BEVERAGE,MILK TEA,FIXED LOCATION\r\n";

    fn parse(text: &str, skip: bool, auto: bool) -> ParsedCsv {
        parse_csv(text, skip, &Columns::default(), auto)
    }
    fn entry<'a>(p: &'a ParsedCsv, field: &str) -> &'a MappingEntry {
        p.mapping.iter().find(|m| m.field == field).unwrap()
    }

    #[test]
    fn the_default_mapping_fits_the_current_template() {
        let p = parse(TEMPLATE, true, false);
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        assert_eq!(p.rows[0].l2, "FNB");
        assert_eq!(p.rows[0].l6, "FIXED LOCATION");
    }

    #[test]
    fn header_names_decide_the_columns() {
        let p = parse(TEMPLATE, true, true);
        assert!(p.mapping.iter().all(|m| m.detected), "{:?}", p.mapping);
        assert_eq!(entry(&p, "serviceCode").column, 2);
        assert_eq!(entry(&p, "merchantName").column, 4);
        assert_eq!(entry(&p, "l2").column, 6);
        assert_eq!(entry(&p, "l6").column, 9);
        assert_eq!(
            entry(&p, "l6").header.as_deref(),
            Some("BU Group code L6 Mặt bằng?")
        );
        assert_eq!(
            entry(&p, "serviceCode").header.as_deref(),
            Some("SERVICE_CODE (agent)")
        );
    }

    #[test]
    fn the_whole_header_is_returned_so_unused_columns_can_be_shown() {
        let p = parse(TEMPLATE, true, true);
        assert_eq!(p.header.len(), 9);
        assert_eq!(p.header[4], "CATEGORY");
        assert!(parse("M,sc\n", false, false).header.is_empty());
    }

    #[test]
    fn a_reordered_template_still_maps_correctly() {
        // Same fields, different order and an extra leading column.
        let text = "ID2,Merchant (x),BU Group code L6,BU Group code L4,BU Group code L3,BU Group code L2,SERVICE_DESCRIPTION,SERVICE_CODE,MID\nz,Shop,LOC,SUB,CAT,IND,Desc,sc9,M9\n";
        let p = parse(text, true, true);
        assert_eq!(
            (
                p.rows[0].service_code.as_str(),
                p.rows[0].merchant_name.as_str(),
                p.rows[0].l2.as_str(),
                p.rows[0].l6.as_str(),
                p.rows[0].mid.as_str()
            ),
            ("sc9", "Shop", "IND", "LOC", "M9")
        );
    }

    #[test]
    fn a_field_the_header_does_not_name_falls_back_to_the_configured_column() {
        let p = parse("MID,SERVICE_CODE,NOTES\nM,sc,x\n", true, true);
        assert!(entry(&p, "serviceCode").detected);
        let l2 = entry(&p, "l2");
        assert!(!l2.detected);
        assert_eq!(l2.column, 6); // the configured default, flagged so the UI can warn
    }

    #[test]
    fn auto_detect_off_or_no_header_uses_the_configured_columns_only() {
        let swapped = "MID,SERVICE_CODE,SERVICE_DESCRIPTION,MERCHANT,CAT,BU Group code L3,BU Group code L2,BU Group code L4,BU Group code L6\nM,sc,d,m,c,AAA,BBB,CCC,DDD\n";
        assert_eq!(parse(swapped, true, true).rows[0].l2, "BBB"); // by name
        assert_eq!(parse(swapped, true, false).rows[0].l2, "AAA"); // by position
        let no_header = parse("M,sc,d,m,c,L2,L3,L4,L6\n", false, true);
        assert!(no_header
            .mapping
            .iter()
            .all(|m| !m.detected && m.header.is_none()));
        assert_eq!(no_header.rows[0].l3, "L3");
    }

    #[test]
    fn header_matching_is_not_fooled_by_look_alikes() {
        assert_eq!(field_of("MID"), Some("mid"));
        assert_eq!(field_of("MID (merchant id)"), Some("mid"));
        assert_eq!(field_of("MIDDLE NAME"), None);
        assert_eq!(
            field_of("SERVICE_DESCRIPTION_ (x)"),
            Some("serviceDescription")
        );
        assert_eq!(field_of("SERVICE_CODE\n(agent)"), Some("serviceCode"));
        assert_eq!(field_of("CATEGORY"), None);
        assert_eq!(field_of("BU Group code L5"), None);
    }

    #[test]
    fn skip_header_drops_the_header_only_when_asked() {
        assert_eq!(parse(TEMPLATE, true, true).rows.len(), 1);
        assert_eq!(parse(TEMPLATE, false, false).rows.len(), 2);
    }

    #[test]
    fn short_rows_are_reported_not_dropped_silently() {
        let p = parse("MID,SERVICE_CODE\nonly,two\n", true, false);
        assert!(p.rows.is_empty());
        assert_eq!(p.errors.len(), 1);
        assert!(
            p.errors[0].error.contains("at least 9 columns"),
            "{}",
            p.errors[0].error
        );
    }

    #[test]
    fn quoted_commas_blank_lines_and_bom_are_handled() {
        let line = "M1,SC1,\"Desc, with comma\",Merchant,x,L2,L3,L4,L6";
        let p = parse(&format!("\u{feff}{line}\n\n,,,,,,,,\n"), false, false);
        assert!(p.errors.is_empty());
        assert_eq!(p.rows.len(), 1);
        assert_eq!(p.rows[0].service_description, "Desc, with comma");
    }

    #[test]
    fn custom_column_mapping_is_honoured_without_a_header() {
        let cols = columns_from(json!({
            "serviceCode": 0, "merchantName": 1, "serviceDescription": 2, "mid": 3, "l2": 4, "l3": 5, "l4": 6, "l6": 7
        }))
        .unwrap();
        let p = parse_csv("SC,Shop,Desc,M,A,B,C,D\n", false, &cols, false);
        assert_eq!(
            (
                p.rows[0].service_code.as_str(),
                p.rows[0].merchant_name.as_str(),
                p.rows[0].l6.as_str()
            ),
            ("SC", "Shop", "D")
        );
        assert_eq!(cols.min_len(), 8);
    }
}
