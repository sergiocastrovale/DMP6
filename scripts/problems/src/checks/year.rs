//! Year / date checks, working on the **raw tag strings** rather than a parsed number.
//!
//! This distinction is the entire reason this module exists. `lofty`'s `tag.date()` returns a parsed
//! `Timestamp`, and by the time a value reaches that form the interesting defects are already gone:
//! `"97"` and `"199?"` both arrive as `None`, indistinguishable from a file with no year at all, and
//! `"0000"` arrives as a perfectly ordinary `Some(0)`. The existing `analysis` crate checks the
//! parsed value and therefore cannot see any of them.

use super::{Reason, ReasonCode};

/// Raw date-ish strings for one file, before any parsing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RawDates {
    /// DATE / TDRC / ©day - what the indexer reads first.
    pub recording: Option<String>,
    /// YEAR / TYER - what it falls back to, but only if `recording` is *absent*.
    pub year: Option<String>,
    /// RELEASEDATE / TDRL.
    pub release: Option<String>,
    /// ORIGINALDATE / TDOR - never read by the indexer at all.
    pub original: Option<String>,
}

/// What a raw year-ish string actually is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YearShape {
    /// No value, or only whitespace.
    Empty,
    /// Parses to a 4-digit year.
    FourDigit(i32),
    /// All digits but zero - stored as 0 rather than NULL, so no missing-year rule ever sees it.
    Zero,
    /// Fewer than 4 digits. The indexer's timestamp parser requires exactly 4 and yields nothing.
    TwoDigit,
    /// Contains something that is not a digit where the year belongs.
    NonNumeric,
}

/// Classify a raw year/date string the way the indexer's parser would see it.
///
/// Accepts a leading 4-digit year followed by any separator (`1997-05-21`, `1997/1998`), because
/// the real parser reads the year segment and tolerates trailing content.
pub fn year_shape(raw: &str) -> YearShape {
    let t = raw.trim();
    if t.is_empty() {
        return YearShape::Empty;
    }

    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return YearShape::NonNumeric;
    }
    if digits.len() < 4 {
        // "97" is a short year the parser will silently drop; "199?" is a corrupt value that
        // merely happens to start with digits. Both lose the year, but they are different
        // mistakes and deserve different messages.
        return if digits.len() == t.len() {
            YearShape::TwoDigit
        } else {
            YearShape::NonNumeric
        };
    }

    let n: i32 = match digits[..4].parse() {
        Ok(n) => n,
        Err(_) => return YearShape::NonNumeric,
    };
    if n == 0 {
        return YearShape::Zero;
    }

    // Digits parsed, but is there junk *inside* the year field rather than after a separator?
    let rest = &t[digits.len().min(t.len())..];
    let rest_ok = rest.is_empty()
        || rest.starts_with(['-', '/', '.', ' ', ';', ',', '\\', 'T', ':'])
        || rest.chars().all(|c| c.is_ascii_digit());
    if !rest_ok {
        return YearShape::NonNumeric;
    }

    YearShape::FourDigit(n)
}

/// Leading 4-digit year, or None. Used to compare DATE against ORIGINALDATE.
pub fn leading_year(raw: &str) -> Option<i32> {
    match year_shape(raw) {
        YearShape::FourDigit(n) => Some(n),
        _ => None,
    }
}

/// Earliest plausible release year. Commercial recordings predate this only as curiosities, and a
/// value below it is invariably a typo or a placeholder.
pub const MIN_PLAUSIBLE_YEAR: i32 = 1860;

/// All year-related defects for one file.
///
/// `current_year` is a parameter rather than read from the clock so the tests are not time bombs.
pub fn check_dates(dates: &RawDates, current_year: i32) -> Vec<Reason> {
    let mut out = Vec::new();

    // The indexer reads `recording` first and, crucially, only falls back to `year` when recording
    // is ABSENT - not when it is present but unparseable. So a file with DATE="199?" and YEAR="1994"
    // ends up with no year at all, even though a perfectly good one is sitting right there.
    let effective = dates
        .recording
        .as_deref()
        .or(dates.year.as_deref())
        .unwrap_or("");
    let shape = year_shape(effective);

    if let (Some(rec), Some(yr)) = (dates.recording.as_deref(), dates.year.as_deref()) {
        let rec_bad = !matches!(year_shape(rec), YearShape::FourDigit(_));
        let yr_good = matches!(year_shape(yr), YearShape::FourDigit(_));
        if rec_bad && yr_good {
            out.push(Reason::new(
                ReasonCode::YearLostToMalformedDate,
                format!("date={rec}, year={yr}"),
            ));
        }
    }

    match shape {
        YearShape::Zero => out.push(Reason::new(
            ReasonCode::YearZero,
            effective.trim().to_string(),
        )),
        YearShape::TwoDigit => out.push(Reason::new(
            ReasonCode::YearTwoDigit,
            effective.trim().to_string(),
        )),
        YearShape::NonNumeric => out.push(Reason::new(
            ReasonCode::YearNonNumeric,
            effective.trim().to_string(),
        )),
        YearShape::FourDigit(n) => {
            if n < MIN_PLAUSIBLE_YEAR || n > current_year + 1 {
                out.push(Reason::new(ReasonCode::YearImplausible, n.to_string()));
            }
        }
        YearShape::Empty => {}
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(rs: &[Reason]) -> Vec<ReasonCode> {
        rs.iter().map(|r| r.code).collect()
    }

    #[test]
    fn shape_classifies_the_cases_the_parsed_value_hides() {
        assert_eq!(year_shape(""), YearShape::Empty);
        assert_eq!(year_shape("   "), YearShape::Empty);
        assert_eq!(year_shape("1997"), YearShape::FourDigit(1997));
        assert_eq!(year_shape("1997-05-03"), YearShape::FourDigit(1997));
        assert_eq!(year_shape("1997/1998"), YearShape::FourDigit(1997));
        assert_eq!(year_shape("0000"), YearShape::Zero);
        assert_eq!(year_shape("97"), YearShape::TwoDigit);
        assert_eq!(year_shape("0"), YearShape::TwoDigit);
        assert_eq!(year_shape("199?"), YearShape::NonNumeric);
        assert_eq!(year_shape("N/A"), YearShape::NonNumeric);
        assert_eq!(year_shape("Unknown"), YearShape::NonNumeric);
    }

    #[test]
    fn leading_year_requires_a_full_four_digits() {
        assert_eq!(leading_year("1997-05-03"), Some(1997));
        assert_eq!(leading_year("97"), None);
        assert_eq!(leading_year("199?"), None);
    }

    #[test]
    fn zero_year_is_reported() {
        let d = RawDates {
            recording: Some("0000".into()),
            ..Default::default()
        };
        assert_eq!(codes(&check_dates(&d, 2026)), vec![ReasonCode::YearZero]);
    }

    #[test]
    fn implausible_years_are_bounded_on_both_ends() {
        let mk = |y: &str| RawDates {
            recording: Some(y.into()),
            ..Default::default()
        };
        assert!(
            check_dates(&mk("2027"), 2026).is_empty(),
            "next year is legitimate for a preorder"
        );
        assert_eq!(
            codes(&check_dates(&mk("2028"), 2026)),
            vec![ReasonCode::YearImplausible]
        );
        assert_eq!(
            codes(&check_dates(&mk("1859"), 2026)),
            vec![ReasonCode::YearImplausible]
        );
        assert!(check_dates(&mk("1860"), 2026).is_empty());
        assert!(check_dates(&mk("1997"), 2026).is_empty());
    }

    #[test]
    fn a_good_year_hidden_behind_a_malformed_date_is_reported() {
        // The lofty behaviour this encodes: date() tries RecordingDate, and does NOT retry Year
        // when that fails to parse. See lofty-0.24.0/src/tag/mod.rs:187.
        let d = RawDates {
            recording: Some("199?".into()),
            year: Some("1994".into()),
            ..Default::default()
        };
        let got = codes(&check_dates(&d, 2026));
        assert!(got.contains(&ReasonCode::YearLostToMalformedDate));
    }

    #[test]
    fn a_good_date_with_a_redundant_year_is_not_reported() {
        let d = RawDates {
            recording: Some("1994".into()),
            year: Some("1994".into()),
            ..Default::default()
        };
        assert!(check_dates(&d, 2026).is_empty());
    }

    #[test]
    fn an_originaldate_differing_from_date_is_no_longer_reported() {
        // Retired: which of the two years is "the" release year is a policy call, not a defect -
        // and in real data originaldate is frequently *later* than date, so it is often the
        // unreliable field rather than the authoritative one.
        let differing = RawDates {
            recording: Some("2011".into()),
            original: Some("1975".into()),
            ..Default::default()
        };
        assert!(check_dates(&differing, 2026).is_empty());
    }

    #[test]
    fn a_missing_year_is_not_reported_here() {
        // Absent-year is deliberately not a defect on its own: huge swathes of a real library have
        // no year and the pipeline copes. Only malformed values are actionable.
        assert!(check_dates(&RawDates::default(), 2026).is_empty());
    }
}
