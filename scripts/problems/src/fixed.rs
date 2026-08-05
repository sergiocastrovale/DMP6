//! The fixed-row ledger: what `--fix:*` has already resolved, shared across every fix kind so one
//! regeneration pass (`report::write_report`) can green-mark rows and update the Summary sheet's
//! `Fixed` column regardless of which `--fix:<type>` produced each entry.
//!
//! Append-only NDJSON next to the spool, same idiom as `spool.rs`'s row log - never edited in place,
//! only ever grown.

use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::checks::ReasonCode;

/// One resolved defect. `detail` carries whatever a fix kind wants to remember beyond the generic
/// fields - e.g. `--fix:years` records the MusicBrainz release-group id/title/artist it matched on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixOutcome {
    pub path: String,
    pub file: String,
    pub code: ReasonCode,
    /// "set" | "cleared" - never "error"; failed files are not recorded here at all, so they can
    /// never be silently marked fixed.
    pub action: String,
    pub field: String,
    pub old_value: String,
    pub new_value: Option<String>,
    pub fix_kind: String,
    #[serde(default)]
    pub detail: serde_json::Value,
    pub fixed_at: String,
}

/// `path -> file -> codes fixed on that file`. Nested (rather than a `(String, String)`-keyed map)
/// so lookups borrow `&str` and don't allocate - this is consulted once per report row, which at
/// full-library scale is millions of calls.
pub struct FixedIndex(HashMap<String, HashMap<String, HashSet<ReasonCode>>>);

impl FixedIndex {
    /// Tolerant of a missing ledger (no fixes applied yet): returns an empty index, not an error.
    pub fn load(path: &Path) -> Self {
        let mut map: HashMap<String, HashMap<String, HashSet<ReasonCode>>> = HashMap::new();
        if let Ok(file) = std::fs::File::open(path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if let Ok(o) = serde_json::from_str::<FixOutcome>(&line) {
                    map.entry(o.path)
                        .or_default()
                        .entry(o.file)
                        .or_default()
                        .insert(o.code);
                }
            }
        }
        Self(map)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn contains_any(&self, path: &str, file: &str, codes: &[ReasonCode]) -> bool {
        self.0
            .get(path)
            .and_then(|files| files.get(file))
            .is_some_and(|fixed_codes| codes.iter().any(|c| fixed_codes.contains(c)))
    }

    /// Distinct files fixed for `code` - the Summary sheet's `Fixed` column.
    pub fn count_for(&self, code: ReasonCode) -> u64 {
        self.0
            .values()
            .flat_map(|files| files.values())
            .filter(|codes| codes.contains(&code))
            .count() as u64
    }
}

pub fn append(path: &Path, outcomes: &[FixOutcome]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    for o in outcomes {
        let line = serde_json::to_string(o)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
    }
    file.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_path() -> std::path::PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "problems-fixed-{}-{}.jsonl",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn outcome(path: &str, file: &str, code: ReasonCode) -> FixOutcome {
        FixOutcome {
            path: path.into(),
            file: file.into(),
            code,
            action: "set".into(),
            field: "RecordingDate".into(),
            old_value: "0000".into(),
            new_value: Some("1990".into()),
            fix_kind: "years".into(),
            detail: serde_json::Value::Null,
            fixed_at: "now".into(),
        }
    }

    #[test]
    fn missing_ledger_loads_as_empty() {
        let idx = FixedIndex::load(&temp_path());
        assert!(idx.is_empty());
        assert!(!idx.contains_any("A/B", "01.mp3", &[ReasonCode::YearZero]));
        assert_eq!(idx.count_for(ReasonCode::YearZero), 0);
    }

    #[test]
    fn append_then_load_round_trips() {
        let p = temp_path();
        append(
            &p,
            &[
                outcome("A/B", "01.mp3", ReasonCode::YearZero),
                outcome("A/B", "02.mp3", ReasonCode::YearNonNumeric),
            ],
        )
        .expect("append");
        let idx = FixedIndex::load(&p);
        assert!(!idx.is_empty());
        assert!(idx.contains_any("A/B", "01.mp3", &[ReasonCode::YearZero]));
        assert!(!idx.contains_any("A/B", "01.mp3", &[ReasonCode::YearNonNumeric]));
        assert!(idx.contains_any(
            "A/B",
            "02.mp3",
            &[ReasonCode::YearZero, ReasonCode::YearNonNumeric]
        ));
        assert!(!idx.contains_any("Other/Album", "01.mp3", &[ReasonCode::YearZero]));
        assert_eq!(idx.count_for(ReasonCode::YearZero), 1);
        assert_eq!(idx.count_for(ReasonCode::YearNonNumeric), 1);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn append_is_additive_across_calls() {
        let p = temp_path();
        append(&p, &[outcome("A/B", "01.mp3", ReasonCode::YearZero)]).expect("append 1");
        append(&p, &[outcome("C/D", "01.mp3", ReasonCode::YearZero)]).expect("append 2");
        let idx = FixedIndex::load(&p);
        assert_eq!(idx.count_for(ReasonCode::YearZero), 2);
        std::fs::remove_file(&p).ok();
    }
}
