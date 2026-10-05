// CSV → `ServiceRow`. Column positions default to the ones the original Java
// tool bound with `@CsvBindByPosition` (columns 4 and 5 were never read), and are
// configurable through `config::Columns`.

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

#[derive(Debug, Serialize)]
pub struct ParsedCsv {
    pub rows: Vec<ServiceRow>,
    pub errors: Vec<RowError>,
}

pub fn parse_csv(text: &str, skip_header: bool, columns: &Columns) -> ParsedCsv {
    let min_columns = columns.min_len();
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(skip_header)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());

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
    ParsedCsv { rows, errors }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Columns;

    const LINE: &str = "M1,SC1,\"Desc, with comma\",Merchant,x,y,L2,GROCERY,L4,L6";

    #[test]
    fn maps_columns_by_position() {
        let p = parse_csv(LINE, false, &Columns::default());
        assert!(p.errors.is_empty());
        assert_eq!(
            p.rows,
            vec![ServiceRow {
                mid: "M1".into(),
                service_code: "SC1".into(),
                service_description: "Desc, with comma".into(),
                merchant_name: "Merchant".into(),
                l2: "L2".into(),
                l3: "GROCERY".into(),
                l4: "L4".into(),
                l6: "L6".into(),
            }]
        );
    }

    #[test]
    fn skip_header_drops_first_line_only_when_asked() {
        let text = format!("a,b,c,d,e,f,g,h,i,j\n{LINE}\n");
        assert_eq!(parse_csv(&text, true, &Columns::default()).rows.len(), 1);
        assert_eq!(parse_csv(&text, false, &Columns::default()).rows.len(), 2);
    }

    #[test]
    fn short_rows_are_reported_not_dropped_silently() {
        let p = parse_csv(
            &format!("only,three,cols\n{LINE}\n"),
            false,
            &Columns::default(),
        );
        assert_eq!(p.rows.len(), 1);
        assert_eq!(p.errors.len(), 1);
        assert_eq!(p.errors[0].line, 1);
    }

    #[test]
    fn blank_lines_and_bom_are_ignored() {
        let p = parse_csv(
            &format!("\u{feff}{LINE}\n\n,,,,,,,,,\n"),
            false,
            &Columns::default(),
        );
        assert_eq!(p.rows.len(), 1);
        assert!(p.errors.is_empty());
    }

    #[test]
    fn custom_column_mapping_is_honoured() {
        let cols = crate::config::columns_from(serde_json::json!({
            "serviceCode": 0, "merchantName": 1, "serviceDescription": 2, "mid": 3, "l2": 4, "l3": 5, "l4": 6, "l6": 7
        }))
        .unwrap();
        let p = parse_csv("SC,Shop,Desc,M,A,B,C,D\n", false, &cols);
        assert!(p.errors.is_empty());
        assert_eq!(
            (
                p.rows[0].service_code.as_str(),
                p.rows[0].merchant_name.as_str(),
                p.rows[0].l6.as_str()
            ),
            ("SC", "Shop", "D")
        );
        // A row only needs as many columns as the mapping reaches (8 here, not 10).
        assert_eq!(cols.min_len(), 8);
    }
}
