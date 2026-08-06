//! `--fix:year`: resolve YEAR_ZERO / YEAR_NON_NUMERIC / YEAR_TWO_DIGIT / YEAR_IMPLAUSIBLE against
//! MusicBrainz.
//!
//! One MB release-group search per unique release folder (not per file), gated to a **perfect**
//! match - exact normalized title, exact normalized artist, and an allow-listed type. Anything short
//! of that (no candidate, title/artist not exact, disallowed type, no parseable year) clears the
//! field instead of guessing - a two-digit or implausible year is exactly as unrecoverable by
//! padding/clamping as a zero or non-numeric one, so all four codes share this one resolution path.
//! The worklist and the "which tag key is actually broken, and which of the four" question both
//! come from `problems`'s own detection code (`crate::audio`, `crate::checks::year`), so this can
//! never disagree with what `problems.xlsx` reported.

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;
use lofty::tag::ItemKey;
use reqwest::Client;

use common::mb::api::{self, RateLimiter};
use common::mb::{allowlist, names::normalize_name};

use crate::audio::{read_tags_guarded, ReadError, TagSnapshot};
use crate::checks::year::{leading_year, year_shape, YearShape, MIN_PLAUSIBLE_YEAR};
use crate::checks::ReasonCode;
use crate::fixed::FixOutcome;

use super::tags::apply_year;
use super::{FixError, FixRunResult};

/// The tag key a file's year defect actually lives on, mirroring `year.rs`'s `effective` derivation
/// exactly: `recording` wins if present, `year` is only consulted when `recording` is absent.
fn effective_key(dates: &crate::checks::year::RawDates) -> Option<(ItemKey, &str)> {
    if let Some(v) = dates.recording.as_deref() {
        return Some((ItemKey::RecordingDate, v));
    }
    if let Some(v) = dates.year.as_deref() {
        return Some((ItemKey::Year, v));
    }
    None
}

/// Which of the four codes this umbrella handles the raw value still reproduces, if any. Mirrors
/// `checks::year::check_dates`' own classification exactly - the same reason `MIN_PLAUSIBLE_YEAR`
/// is `pub` rather than duplicated as a second constant here.
fn defect_code(raw: &str, current_year: i32) -> Option<ReasonCode> {
    match year_shape(raw) {
        YearShape::Zero => Some(ReasonCode::YearZero),
        YearShape::NonNumeric => Some(ReasonCode::YearNonNumeric),
        YearShape::TwoDigit => Some(ReasonCode::YearTwoDigit),
        YearShape::FourDigit(n) if n < MIN_PLAUSIBLE_YEAR || n > current_year + 1 => {
            Some(ReasonCode::YearImplausible)
        }
        YearShape::FourDigit(_) | YearShape::Empty => None,
    }
}

pub async fn run(
    root: &Path,
    worklist: &BTreeMap<String, Vec<String>>,
    dry_run: bool,
) -> Result<FixRunResult, String> {
    let current_year: i32 = chrono::Local::now()
        .format("%Y")
        .to_string()
        .parse()
        .expect("current year formats as digits");

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut limiter = RateLimiter::new();

    let mut result = FixRunResult::default();

    for (rel_path, files) in worklist {
        let folder = root.join(rel_path);

        // Read every defective file's own tags up front - both to derive the search query from a
        // majority vote among exactly these files (not "whichever file happens to be first" - a
        // folder already flagged FolderMultipleAlbums/FolderMultipleAlbumArtists can genuinely mix
        // several unrelated releases, and picking one file's tags at random risks resolving a year
        // for the wrong album entirely) and to reuse the read for the actual fix below.
        let reads: Vec<(&String, Result<TagSnapshot, ReadError>)> = files
            .iter()
            .map(|file| {
                let abs_path = folder.join(file);
                (file, read_tags_guarded(&abs_path))
            })
            .collect();

        let query = majority_query(reads.iter().filter_map(|(_, r)| r.as_ref().ok()));

        let year_result = match &query {
            Some(q) => resolve_release_year(&client, &mut limiter, q).await,
            None => Err(format!(
                "{rel_path}: defective files don't agree on album+artist tags - cannot search MB safely"
            )),
        };

        let (resolved_year, rg_id, mb_title, mb_artist) = match &year_result {
            Ok(m) => (m.year, m.rg_id.clone(), m.title.clone(), m.artist.clone()),
            Err(_) => (None, None, None, None),
        };
        let mb_call_failed = year_result.is_err();
        if let Err(e) = &year_result {
            eprintln!("  {} {}", "!".bright_red(), e);
        } else {
            match resolved_year {
                Some(y) => println!("  {} {} -> {}", "✓".green(), rel_path, y),
                None => println!("  {} {} -> null (no perfect match)", "-".yellow(), rel_path),
            }
        }

        for (file, snap_result) in &reads {
            let abs_path = folder.join(file);
            match process_file(
                rel_path,
                file,
                &abs_path,
                snap_result,
                resolved_year,
                rg_id.clone(),
                mb_title.clone(),
                mb_artist.clone(),
                mb_call_failed,
                dry_run,
                current_year,
            ) {
                Ok(outcome) => result.outcomes.push(outcome),
                Err(error) => result.errors.push(error),
            }
        }
    }

    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn process_file(
    rel_path: &str,
    file: &str,
    abs_path: &Path,
    snap_result: &Result<TagSnapshot, ReadError>,
    resolved_year: Option<i32>,
    rg_id: Option<String>,
    mb_title: Option<String>,
    mb_artist: Option<String>,
    mb_call_failed: bool,
    dry_run: bool,
    current_year: i32,
) -> Result<FixOutcome, FixError> {
    let err = |message: String| FixError {
        path: rel_path.to_string(),
        file: file.to_string(),
        message,
    };

    let snap = snap_result
        .as_ref()
        .map_err(|e| err(format!("cannot read tags: {}", e.detail())))?;

    let (key, raw) =
        effective_key(&snap.dates).ok_or_else(|| err("no date field present - defect no longer reproduces".to_string()))?;
    let code = defect_code(raw, current_year).ok_or_else(|| {
        err("field no longer YEAR_ZERO/YEAR_NON_NUMERIC/YEAR_TWO_DIGIT/YEAR_IMPLAUSIBLE - tags changed since scan".to_string())
    })?;

    if mb_call_failed {
        return Err(err(
            "MusicBrainz lookup failed - left untouched, retry later".to_string(),
        ));
    }

    if !dry_run {
        apply_year(abs_path, key, resolved_year).map_err(|e| err(format!("write failed: {e}")))?;
    }

    let detail = serde_json::json!({
        "mbReleaseGroupId": rg_id,
        "mbTitle": mb_title,
        "mbArtist": mb_artist,
    });

    Ok(FixOutcome {
        path: rel_path.to_string(),
        file: file.to_string(),
        code,
        action: if resolved_year.is_some() { "set" } else { "cleared" }.to_string(),
        field: field_name(&key).to_string(),
        old_value: raw.to_string(),
        new_value: resolved_year.map(|y| y.to_string()),
        fix_kind: "years".to_string(),
        detail,
        fixed_at: chrono::Local::now().to_rfc3339(),
    })
}

fn field_name(key: &ItemKey) -> &'static str {
    match key {
        ItemKey::RecordingDate => "RecordingDate",
        ItemKey::Year => "Year",
        _ => "Other",
    }
}

struct YearMatch {
    year: Option<i32>,
    rg_id: Option<String>,
    title: Option<String>,
    artist: Option<String>,
}

/// One release folder -> one MB call in the common case. `query` is the majority-vote album+artist
/// among the folder's own defective files (see `majority_query`), not an arbitrary first file.
async fn resolve_release_year(
    client: &Client,
    limiter: &mut RateLimiter,
    query: &QueryTags,
) -> Result<YearMatch, String> {
    let found = api::mb_search_release_group(client, &query.album, &query.artist, limiter)
        .await
        .map_err(|e| format!("MB search failed: {e}"))?;

    let Some(rg) = found else {
        return Ok(YearMatch {
            year: None,
            rg_id: None,
            title: None,
            artist: None,
        });
    };

    let artist_credit = rg.artist_credit.join(" & ");
    let is_perfect = is_perfect_match(
        &rg.title,
        &artist_credit,
        &query.album,
        &query.artist,
        rg.primary_type.as_deref(),
        &rg.secondary_types,
    );

    if !is_perfect {
        return Ok(YearMatch {
            year: None,
            rg_id: Some(rg.id),
            title: Some(rg.title),
            artist: Some(artist_credit),
        });
    }

    // The release-group's own first-release-date is what MusicBrainz itself shows as this album's
    // year - the earliest release in the group, independent of which edition a plain `release`
    // lookup happens to return first. Only fall back to browsing editions when a release-group
    // legitimately lacks one (rare, but not unheard of for obscure entries).
    let year = match rg.first_release_date.as_deref().and_then(leading_year) {
        Some(y) => Some(y),
        None => {
            let releases = api::mb_get_release_tracks(client, &rg.id, limiter)
                .await
                .map_err(|e| format!("MB release lookup failed: {e}"))?;
            releases
                .first()
                .and_then(|(release, _)| release.date.as_deref())
                .and_then(leading_year)
        }
    };

    Ok(YearMatch {
        year,
        rg_id: Some(rg.id),
        title: Some(rg.title),
        artist: Some(artist_credit),
    })
}

/// "PERFECT" gate: exact normalized title, exact normalized artist, and an allow-listed release
/// type. No score threshold, no fuzzy `names_are_similar` fallback - short of this, the caller treats
/// the release as unmatched and nulls the field rather than guessing.
fn is_perfect_match(
    candidate_title: &str,
    candidate_artist_credit: &str,
    local_album: &str,
    local_artist: &str,
    primary_type: Option<&str>,
    secondary_types: &[String],
) -> bool {
    normalize_name(candidate_title) == normalize_name(local_album)
        && normalize_name(candidate_artist_credit) == normalize_name(local_artist)
        && allowlist::is_allowed(primary_type, secondary_types, None)
}

#[derive(Debug, PartialEq, Eq, Hash, Clone)]
struct QueryTags {
    album: String,
    artist: String,
}

/// The album+artist pair a strict majority of the group's own (tag-readable) defective files agree
/// on. A folder can legitimately mix releases (that is itself a separate, already-flagged defect -
/// `FolderMultipleAlbums`/`FolderMultipleAlbumArtists`), so this refuses to pick a query when there
/// is no clear majority rather than guessing off whichever file happened to read first.
fn majority_query<'a>(snaps: impl Iterator<Item = &'a TagSnapshot>) -> Option<QueryTags> {
    let mut counts: std::collections::HashMap<QueryTags, usize> = std::collections::HashMap::new();
    for snap in snaps {
        if let Some(q) = tags_to_query(snap) {
            *counts.entry(q).or_insert(0) += 1;
        }
    }
    let total: usize = counts.values().sum();
    if total == 0 {
        return None;
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .filter(|(_, c)| c * 2 > total)
        .map(|(q, _)| q)
}

fn tags_to_query(snap: &TagSnapshot) -> Option<QueryTags> {
    let album = snap.album.as_deref()?.trim();
    let artist = snap
        .album_artist
        .as_deref()
        .or(snap.artist.as_deref())?
        .trim();
    if album.is_empty() || artist.is_empty() {
        return None;
    }
    Some(QueryTags {
        album: album.to_string(),
        artist: artist.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::year::RawDates;

    fn dates(recording: Option<&str>, year: Option<&str>) -> RawDates {
        RawDates {
            recording: recording.map(str::to_string),
            year: year.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn effective_key_prefers_recording_when_present() {
        let d = dates(Some("0000"), Some("1994"));
        let (key, raw) = effective_key(&d).unwrap();
        assert_eq!(key, ItemKey::RecordingDate);
        assert_eq!(raw, "0000");
    }

    #[test]
    fn effective_key_falls_back_to_year_only_when_recording_absent() {
        let d = dates(None, Some("xxxx"));
        let (key, raw) = effective_key(&d).unwrap();
        assert_eq!(key, ItemKey::Year);
        assert_eq!(raw, "xxxx");
    }

    #[test]
    fn defect_code_covers_all_four_shapes() {
        assert_eq!(defect_code("0000", 2026), Some(ReasonCode::YearZero));
        assert_eq!(defect_code("N/A", 2026), Some(ReasonCode::YearNonNumeric));
        assert_eq!(defect_code("97", 2026), Some(ReasonCode::YearTwoDigit));
        assert_eq!(
            defect_code("196", 2026),
            Some(ReasonCode::YearTwoDigit),
            "3-digit truncation is still short of 4, not implausible"
        );
        assert_eq!(
            defect_code("1859", 2026),
            Some(ReasonCode::YearImplausible)
        );
        assert_eq!(
            defect_code("2028", 2026),
            Some(ReasonCode::YearImplausible)
        );
    }

    #[test]
    fn defect_code_is_none_for_a_plausible_four_digit_year() {
        assert_eq!(defect_code("1997", 2026), None);
        assert_eq!(defect_code("2027", 2026), None, "next year is a preorder");
    }

    #[test]
    fn effective_key_none_when_both_absent() {
        assert!(effective_key(&dates(None, None)).is_none());
    }

    #[test]
    fn perfect_match_requires_exact_title_and_artist() {
        assert!(is_perfect_match(
            "D.R.O.P",
            "ZELDA",
            "D.R.O.P",
            "ZELDA",
            Some("Album"),
            &[],
        ));
    }

    #[test]
    fn perfect_match_tolerates_case_and_the_prefix_drift() {
        // normalize_name lowercases and drops a leading "the " - same bar the strict artist
        // resolver uses, not the fuzzy sync-tier similarity check.
        assert!(is_perfect_match(
            "Tribute To Jimi Hendrix, Live",
            "Eric Johnson",
            "tribute to jimi hendrix, live",
            "ERIC JOHNSON",
            Some("Album"),
            &[],
        ));
    }

    #[test]
    fn perfect_match_rejects_partial_title_overlap() {
        // The fuzzy sync-tier gate (names_are_similar) would accept this; PERFECT must not.
        assert!(!is_perfect_match(
            "Excalibur Awakens",
            "Midori",
            "Excalibur",
            "Midori",
            Some("Album"),
            &[],
        ));
    }

    #[test]
    fn perfect_match_rejects_wrong_artist_even_with_right_title() {
        assert!(!is_perfect_match(
            "D.R.O.P",
            "Some Other Band",
            "D.R.O.P",
            "ZELDA",
            Some("Album"),
            &[],
        ));
    }

    #[test]
    fn perfect_match_rejects_disallowed_type() {
        assert!(!is_perfect_match(
            "D.R.O.P",
            "ZELDA",
            "D.R.O.P",
            "ZELDA",
            Some("Single"),
            &[],
        ));
    }
}
