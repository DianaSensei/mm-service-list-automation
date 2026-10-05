// CSV → `ServiceRow`. Column positions are the ones the original Java tool
// bound with `@CsvBindByPosition`; columns 4 and 5 were never read.

use serde::{Deserialize, Serialize};

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

/// Highest column index read (`l6`) + 1.
const MIN_COLUMNS: usize = 10;

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

pub fn parse_csv(text: &str, skip_header: bool) -> ParsedCsv {
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
        if record.len() < MIN_COLUMNS {
            errors.push(RowError {
                line,
                error: format!(
                    "expected at least {MIN_COLUMNS} columns, found {}",
                    record.len()
                ),
            });
            continue;
        }
        let col = |i: usize| record.get(i).unwrap_or_default().to_string();
        rows.push(ServiceRow {
            mid: col(0),
            service_code: col(1),
            service_description: col(2),
            merchant_name: col(3),
            l2: col(6),
            l3: col(7),
            l4: col(8),
            l6: col(9),
        });
    }
    ParsedCsv { rows, errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = "M1,SC1,\"Desc, with comma\",Merchant,x,y,L2,GROCERY,L4,L6";

    #[test]
    fn maps_columns_by_position() {
        let p = parse_csv(LINE, false);
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
        assert_eq!(parse_csv(&text, true).rows.len(), 1);
        assert_eq!(parse_csv(&text, false).rows.len(), 2);
    }

    #[test]
    fn short_rows_are_reported_not_dropped_silently() {
        let p = parse_csv(&format!("only,three,cols\n{LINE}\n"), false);
        assert_eq!(p.rows.len(), 1);
        assert_eq!(p.errors.len(), 1);
        assert_eq!(p.errors[0].line, 1);
    }

    #[test]
    fn blank_lines_and_bom_are_ignored() {
        let p = parse_csv(&format!("\u{feff}{LINE}\n\n,,,,,,,,,\n"), false);
        assert_eq!(p.rows.len(), 1);
        assert!(p.errors.is_empty());
    }
}
