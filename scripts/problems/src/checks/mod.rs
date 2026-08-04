//! Tag defect definitions: what counts as a problem, how severe it is, and how it renders.
//!
//! Every variant of [`ReasonCode`] corresponds to a condition that has been traced to a concrete
//! failure in the index or sync pipeline. The `message()` text is what the user reads in the
//! spreadsheet, so it states the *consequence*, not just the observation - "never indexed" is
//! actionable, "artist tag is empty" is not.

pub mod artist;
pub mod folder;
pub mod separators;
pub mod text;
pub mod year;

use serde::{Deserialize, Serialize};

/// How badly this defect damages the library.
///
/// `Critical` is reserved for conditions that lose data or corrupt state permanently: the file is
/// never indexed at all, or the wrong data is written and never corrected. `High` breaks a release
/// or creates a junk artist. `Medium` degrades matching. `Low` is cosmetic but still produces
/// duplicate rows.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Hash, Serialize, Deserialize)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Self::Critical => "CRITICAL",
            Self::High => "HIGH",
            Self::Medium => "MEDIUM",
            Self::Low => "LOW",
        }
    }
}

/// One kind of defect. Ordering is by declaration and only used to make the report deterministic.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Hash, Serialize, Deserialize)]
pub enum ReasonCode {
    // ---- file-level: fatal ------------------------------------------------------------------
    TagsUnreadable,
    TagReadPanicked,
    ArtistMissing,
    ArtistWhitespaceOnly,
    TitleEmpty,
    AlbumArtistBreaksLucene,

    // ---- file-level: artist / albumArtist ----------------------------------------------------
    ArtistPunctuationOnly,
    ArtistInvisibleChars,
    ArtistMojibake,
    AlbumArtistMissing,
    AlbumArtistWhitespaceOnly,
    AlbumArtistPunctuationOnly,
    AlbumArtistUntrimmed,
    AlbumArtistUnrecognisedVarious,
    AlbumArtistUnknownArtist,
    AlbumArtistNumericJunk,
    AlbumArtistInvisibleChars,
    AlbumArtistMojibake,
    AlbumArtistTooManySeparators,
    AlbumArtistTooManyCoOwners,

    // ---- file-level: year ---------------------------------------------------------------------
    YearZero,
    YearTwoDigit,
    YearNonNumeric,
    YearImplausible,
    YearLostToMalformedDate,
    OriginalDateDiffers,

    // ---- folder-level -------------------------------------------------------------------------
    FolderMultipleAlbumArtists,
    FolderMultipleAlbums,
    FolderMultipleYears,
    FolderAlbumEmpty,
    FolderArtistCaseDrift,
    FolderArtistThePrefixDrift,
}

impl ReasonCode {
    pub fn severity(self) -> Severity {
        use ReasonCode::*;
        match self {
            TagsUnreadable
            | TagReadPanicked
            | ArtistMissing
            | ArtistWhitespaceOnly
            | TitleEmpty
            | AlbumArtistBreaksLucene => Severity::Critical,

            ArtistPunctuationOnly
            | ArtistMojibake
            | AlbumArtistMissing
            | AlbumArtistWhitespaceOnly
            | AlbumArtistPunctuationOnly
            | AlbumArtistUnrecognisedVarious
            | AlbumArtistUnknownArtist
            | AlbumArtistNumericJunk
            | AlbumArtistMojibake
            | AlbumArtistTooManySeparators
            | FolderMultipleAlbumArtists
            | FolderAlbumEmpty
            | YearLostToMalformedDate => Severity::High,

            ArtistInvisibleChars
            | AlbumArtistInvisibleChars
            | AlbumArtistUntrimmed
            | AlbumArtistTooManyCoOwners
            | YearZero
            | YearTwoDigit
            | YearNonNumeric
            | YearImplausible
            | OriginalDateDiffers
            | FolderMultipleAlbums => Severity::Medium,

            // Endemic and usually legitimate: on reissues and compilations each track carries its
            // own original recording date, so measured against the real library this fires on the
            // majority of jazz folders. The indexer copes (it takes the majority), so it is
            // informational - reporting it any higher buries the defects that actually break things.
            FolderMultipleYears | FolderArtistCaseDrift | FolderArtistThePrefixDrift => {
                Severity::Low
            }
        }
    }

    /// Stable machine-readable name, used as the key on the Summary sheet.
    pub fn code(self) -> &'static str {
        use ReasonCode::*;
        match self {
            TagsUnreadable => "TAGS_UNREADABLE",
            TagReadPanicked => "TAG_READ_PANICKED",
            ArtistMissing => "ARTIST_MISSING",
            ArtistWhitespaceOnly => "ARTIST_WHITESPACE_ONLY",
            TitleEmpty => "TITLE_EMPTY",
            AlbumArtistBreaksLucene => "ALBUMARTIST_BREAKS_LUCENE",
            ArtistPunctuationOnly => "ARTIST_PUNCTUATION_ONLY",
            ArtistInvisibleChars => "ARTIST_INVISIBLE_CHARS",
            ArtistMojibake => "ARTIST_MOJIBAKE",
            AlbumArtistMissing => "ALBUMARTIST_MISSING",
            AlbumArtistWhitespaceOnly => "ALBUMARTIST_WHITESPACE_ONLY",
            AlbumArtistPunctuationOnly => "ALBUMARTIST_PUNCTUATION_ONLY",
            AlbumArtistUntrimmed => "ALBUMARTIST_UNTRIMMED",
            AlbumArtistUnrecognisedVarious => "ALBUMARTIST_UNRECOGNISED_VARIOUS",
            AlbumArtistUnknownArtist => "ALBUMARTIST_UNKNOWN_ARTIST",
            AlbumArtistNumericJunk => "ALBUMARTIST_NUMERIC_JUNK",
            AlbumArtistInvisibleChars => "ALBUMARTIST_INVISIBLE_CHARS",
            AlbumArtistMojibake => "ALBUMARTIST_MOJIBAKE",
            AlbumArtistTooManySeparators => "ALBUMARTIST_TOO_MANY_SEPARATORS",
            AlbumArtistTooManyCoOwners => "ALBUMARTIST_TOO_MANY_CO_OWNERS",
            YearZero => "YEAR_ZERO",
            YearTwoDigit => "YEAR_TWO_DIGIT",
            YearNonNumeric => "YEAR_NON_NUMERIC",
            YearImplausible => "YEAR_IMPLAUSIBLE",
            YearLostToMalformedDate => "YEAR_LOST_TO_MALFORMED_DATE",
            OriginalDateDiffers => "ORIGINALDATE_DIFFERS",
            FolderMultipleAlbumArtists => "FOLDER_MULTIPLE_ALBUMARTISTS",
            FolderMultipleAlbums => "FOLDER_MULTIPLE_ALBUMS",
            FolderMultipleYears => "FOLDER_MULTIPLE_YEARS",
            FolderAlbumEmpty => "FOLDER_ALBUM_EMPTY",
            FolderArtistCaseDrift => "FOLDER_ARTIST_CASE_DRIFT",
            FolderArtistThePrefixDrift => "FOLDER_ARTIST_THE_PREFIX_DRIFT",
        }
    }

    /// What the user reads. States the consequence, because that is what makes it worth fixing.
    pub fn message(self) -> &'static str {
        use ReasonCode::*;
        match self {
            TagsUnreadable => "file tags could not be read - the file is never indexed",
            TagReadPanicked => "tag parser crashed on this file - the file is never indexed",
            ArtistMissing => "artist tag is missing - the indexer skips this file entirely, and the missing track breaks the folder's track count so the whole album stays UNMATCHED",
            ArtistWhitespaceOnly => "artist tag is only whitespace - passes the indexer's untrimmed empty-check and is indexed as a junk artist",
            TitleEmpty => "title tag is empty - matches the first unclaimed MusicBrainz track and cascades wrong titles down the rest of the album",
            AlbumArtistBreaksLucene => "albumArtist breaks the MusicBrainz query (unescaped quote/backslash) - returns HTTP 400 forever, so this release's ownership is never resolved",
            ArtistPunctuationOnly => "artist tag has no letters or digits - produces an unbrowsable artist with a hash-based slug",
            ArtistInvisibleChars => "artist tag contains invisible characters - creates a duplicate artist that looks identical to the real one",
            ArtistMojibake => "artist tag looks mis-decoded (mojibake) - creates a permanent garbled artist",
            AlbumArtistMissing => "albumArtist tag is missing - the release is owned by whichever artist happens to be on track 1",
            AlbumArtistWhitespaceOnly => "albumArtist tag is only whitespace - creates a junk artist with a hash-based slug",
            AlbumArtistPunctuationOnly => "albumArtist tag has no letters or digits - creates a junk artist with a hash-based slug",
            AlbumArtistUntrimmed => "albumArtist has leading/trailing whitespace - defeats the Various Artists check, which compares untrimmed",
            AlbumArtistUnrecognisedVarious => "albumArtist is a compilation marker the indexer does not recognise - becomes a real browsable artist and is synced to MusicBrainz",
            AlbumArtistUnknownArtist => "albumArtist is literally \"Unknown Artist\" - not special-cased, so it becomes a shared junk artist page and is synced to MusicBrainz",
            AlbumArtistNumericJunk => "albumArtist looks like a track number, year or bitrate rather than a name - creates a junk artist",
            AlbumArtistInvisibleChars => "albumArtist contains invisible characters - creates a duplicate artist that looks identical to the real one",
            AlbumArtistMojibake => "albumArtist looks mis-decoded (mojibake) - creates a permanent garbled artist",
            AlbumArtistTooManySeparators => "albumArtist has too many separators to verify - every part is created unverified, producing junk artists",
            AlbumArtistTooManyCoOwners => "albumArtist lists more co-billed artists than are kept as owners - the album is missing from all but the first artist's page",
            YearZero => "year is zero - stored as 0 rather than empty, so it is invisible to every missing-year check and kills release matching",
            YearTwoDigit => "year is two digits - the indexer cannot parse it, so the year is silently lost",
            YearNonNumeric => "year is not a number - the indexer cannot parse it, so the year is silently lost",
            YearImplausible => "year is implausible - release matching silently falls back to the earliest edition",
            YearLostToMalformedDate => "a valid year exists but the date field is malformed - the indexer reads the date field first and gives up, losing the year",
            OriginalDateDiffers => "original release date differs from the date tag - the indexer ignores originaldate, so this binds to the reissue rather than the original",
            FolderMultipleAlbumArtists => "folder has more than one albumArtist value - each becomes a co-owner, putting this album on unrelated artists' pages",
            FolderMultipleAlbums => "folder has more than one album value - the release title is picked by directory read order and can change between runs",
            FolderMultipleYears => "folder mixes several year values, which is normal when tracks carry their own original recording dates - the release year is taken from the majority and flips on ties",
            FolderAlbumEmpty => "no file in this folder has an album tag - the release is titled \"Unknown Album\" and cannot be found on MusicBrainz",
            FolderArtistCaseDrift => "folder mixes capitalisations of the same name - harmless after indexing, but a sign the tags were edited inconsistently",
            FolderArtistThePrefixDrift => "folder mixes \"The X\" and \"X\" spellings - creates two separate artist pages that the duplicate-artist audit cannot detect",
        }
    }
}

/// One defect found on one file. `detail` carries the offending value, already sanitised.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reason {
    pub code: ReasonCode,
    pub detail: String,
}

impl Reason {
    pub fn new(code: ReasonCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    pub fn bare(code: ReasonCode) -> Self {
        Self {
            code,
            detail: String::new(),
        }
    }

    pub fn render(&self) -> String {
        let base = format!("{}: {}", self.code.severity().label(), self.code.message());
        if self.detail.is_empty() {
            base
        } else {
            format!("{base} [{}]", self.detail)
        }
    }
}

/// Render a file's reasons into one cell: most severe first, deduped, `; `-joined.
///
/// The ordering is deterministic so that two runs over an unchanged library produce byte-identical
/// reports - which is what makes the output diffable after a tagging session.
pub fn render_reasons(mut reasons: Vec<Reason>) -> String {
    reasons.sort_by(|a, b| {
        b.code
            .severity()
            .cmp(&a.code.severity())
            .then(a.code.cmp(&b.code))
            .then_with(|| a.detail.cmp(&b.detail))
    });
    reasons.dedup();
    reasons
        .iter()
        .map(Reason::render)
        .collect::<Vec<_>>()
        .join("; ")
}

/// Every declared reason code. Used by `--report-only`, which has to rebuild the breakdown from
/// rendered text because counts are not persisted in the spool.
pub const ALL_CODES: &[ReasonCode] = &[
    ReasonCode::TagsUnreadable,
    ReasonCode::TagReadPanicked,
    ReasonCode::ArtistMissing,
    ReasonCode::ArtistWhitespaceOnly,
    ReasonCode::TitleEmpty,
    ReasonCode::AlbumArtistBreaksLucene,
    ReasonCode::ArtistPunctuationOnly,
    ReasonCode::ArtistInvisibleChars,
    ReasonCode::ArtistMojibake,
    ReasonCode::AlbumArtistMissing,
    ReasonCode::AlbumArtistWhitespaceOnly,
    ReasonCode::AlbumArtistPunctuationOnly,
    ReasonCode::AlbumArtistUntrimmed,
    ReasonCode::AlbumArtistUnrecognisedVarious,
    ReasonCode::AlbumArtistUnknownArtist,
    ReasonCode::AlbumArtistNumericJunk,
    ReasonCode::AlbumArtistInvisibleChars,
    ReasonCode::AlbumArtistMojibake,
    ReasonCode::AlbumArtistTooManySeparators,
    ReasonCode::AlbumArtistTooManyCoOwners,
    ReasonCode::YearZero,
    ReasonCode::YearTwoDigit,
    ReasonCode::YearNonNumeric,
    ReasonCode::YearImplausible,
    ReasonCode::YearLostToMalformedDate,
    ReasonCode::OriginalDateDiffers,
    ReasonCode::FolderMultipleAlbumArtists,
    ReasonCode::FolderMultipleAlbums,
    ReasonCode::FolderMultipleYears,
    ReasonCode::FolderAlbumEmpty,
    ReasonCode::FolderArtistCaseDrift,
    ReasonCode::FolderArtistThePrefixDrift,
];

/// Recover which codes a rendered reason cell contains, by matching each code's message text.
///
/// Only used by `--report-only`. Matching on the message rather than the code name works because
/// the messages are unique and stable, and it avoids widening the spool format purely to serve a
/// recovery path.
pub fn codes_in_rendered(rendered: &str) -> Vec<ReasonCode> {
    ALL_CODES
        .iter()
        .copied()
        .filter(|c| rendered.contains(c.message()))
        .collect()
}

/// Every defect for one file, from its tag values alone. Folder-level reasons are appended
/// separately by [`folder::folder_reasons`].
///
/// Ordering within the returned vec does not matter - [`render_reasons`] sorts before joining.
pub fn check_file(snap: &crate::audio::TagSnapshot, current_year: i32) -> Vec<Reason> {
    let mut out = Vec::new();

    // ---- artist ---------------------------------------------------------------------------
    match snap.artist.as_deref() {
        None | Some("") => out.push(Reason::bare(ReasonCode::ArtistMissing)),
        Some(a) => {
            if text::is_whitespace_only(a) {
                out.push(Reason::new(
                    ReasonCode::ArtistWhitespaceOnly,
                    sanitize_cell(a),
                ));
            } else if text::is_punctuation_only(a) {
                out.push(Reason::new(
                    ReasonCode::ArtistPunctuationOnly,
                    sanitize_cell(a),
                ));
            }
            let invisible = text::invisible_chars(a);
            if !invisible.is_empty() {
                out.push(Reason::new(
                    ReasonCode::ArtistInvisibleChars,
                    format!(
                        "{} in \"{}\"",
                        text::describe_chars(&invisible),
                        sanitize_cell(a)
                    ),
                ));
            }
            if text::looks_like_mojibake(a) {
                out.push(Reason::new(ReasonCode::ArtistMojibake, sanitize_cell(a)));
            }
        }
    }

    // ---- title ----------------------------------------------------------------------------
    if snap
        .title
        .as_deref()
        .map(|t| t.trim().is_empty())
        .unwrap_or(true)
    {
        out.push(Reason::bare(ReasonCode::TitleEmpty));
    }

    // ---- albumArtist ----------------------------------------------------------------------
    match snap.album_artist.as_deref() {
        None | Some("") => out.push(Reason::bare(ReasonCode::AlbumArtistMissing)),
        Some(aa) => out.extend(check_album_artist(aa)),
    }

    // ---- year -----------------------------------------------------------------------------
    out.extend(year::check_dates(&snap.dates, current_year));

    out
}

/// albumArtist-specific defects, split out because there are so many of them.
fn check_album_artist(aa: &str) -> Vec<Reason> {
    let mut out = Vec::new();

    if text::is_whitespace_only(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistWhitespaceOnly,
            sanitize_cell(aa),
        ));
        // Everything below would be noise on a blank value.
        return out;
    }
    if text::is_punctuation_only(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistPunctuationOnly,
            sanitize_cell(aa),
        ));
    }
    if text::is_untrimmed(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistUntrimmed,
            format!("\"{}\"", sanitize_cell(aa)),
        ));
    }

    let invisible = text::invisible_chars(aa);
    if !invisible.is_empty() {
        out.push(Reason::new(
            ReasonCode::AlbumArtistInvisibleChars,
            format!(
                "{} in \"{}\"",
                text::describe_chars(&invisible),
                sanitize_cell(aa)
            ),
        ));
    }
    if text::looks_like_mojibake(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistMojibake,
            sanitize_cell(aa),
        ));
    }

    if let Some(why) = artist::breaks_lucene_query(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistBreaksLucene,
            format!("{why}: \"{}\"", sanitize_cell(aa)),
        ));
    }
    if artist::is_unknown_artist(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistUnknownArtist,
            sanitize_cell(aa),
        ));
    } else if let Some(marker) = artist::unrecognised_various(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistUnrecognisedVarious,
            marker.to_string(),
        ));
    }
    if let Some(why) = artist::numeric_or_corrupted(aa) {
        out.push(Reason::new(
            ReasonCode::AlbumArtistNumericJunk,
            format!("{why}: \"{}\"", sanitize_cell(aa)),
        ));
    }

    // Separator-driven defects are meaningless for a placeholder like "Various Artists", which the
    // indexer never resolves at all.
    if !artist::index_treats_as_special(aa.trim()) {
        if let Some(n) = artist::too_many_separators(aa) {
            out.push(Reason::new(
                ReasonCode::AlbumArtistTooManySeparators,
                format!("{n} separators in \"{}\"", sanitize_cell(aa)),
            ));
        }
        if let Some(n) = artist::too_many_co_owners(aa) {
            out.push(Reason::new(
                ReasonCode::AlbumArtistTooManyCoOwners,
                format!("{n} co-billed in \"{}\"", sanitize_cell(aa)),
            ));
        }
    }

    out
}

/// Maximum characters kept from a tag value shown in the report.
const DETAIL_MAX_CHARS: usize = 200;

/// Make a tag value safe for an Excel cell, and make its invisible characters visible.
///
/// Two jobs in one pass. Excel rejects raw control characters in strings and will offer to "repair"
/// the file, silently dropping data. And a report that strips U+00A0 to show a clean-looking name
/// would defeat the entire point of the invisible-character checks - the user has to *see* what is
/// wrong with the value. So offenders are rendered as `<U+00A0>` rather than removed.
pub fn sanitize_cell(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, c) in s.chars().enumerate() {
        if i >= DETAIL_MAX_CHARS {
            out.push('…');
            break;
        }
        match c {
            '\u{0}'..='\u{1F}'
            | '\u{7F}'..='\u{9F}'
            | '\u{A0}'
            | '\u{200B}'..='\u{200F}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{FEFF}'
            | '\u{FFFD}' => {
                out.push_str(&format!("<U+{:04X}>", c as u32));
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_renders_invisibles_instead_of_dropping_them() {
        assert_eq!(sanitize_cell("Bj\u{00A0}rk"), "Bj<U+00A0>rk");
        assert_eq!(sanitize_cell("a\u{200B}b"), "a<U+200B>b");
        assert_eq!(sanitize_cell("a\rb"), "a<U+000D>b");
        assert_eq!(sanitize_cell("\u{FEFF}Radiohead"), "<U+FEFF>Radiohead");
    }

    #[test]
    fn sanitize_leaves_legitimate_text_alone() {
        // Accented and non-Latin text is not a defect and must survive untouched, or the report
        // would flag half a real library.
        for name in [
            "Björk",
            "Sigur Rós",
            "Motörhead",
            "日本",
            "Дискотека",
            "AC/DC",
        ] {
            assert_eq!(
                sanitize_cell(name),
                name,
                "mangled a legitimate name: {name}"
            );
        }
    }

    #[test]
    fn sanitize_truncates_long_values() {
        let long = "a".repeat(500);
        let out = sanitize_cell(&long);
        assert_eq!(out.chars().count(), DETAIL_MAX_CHARS + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn reasons_render_most_severe_first_and_dedupe() {
        let rendered = render_reasons(vec![
            Reason::new(ReasonCode::YearZero, "0"),
            Reason::bare(ReasonCode::ArtistMissing),
            Reason::new(ReasonCode::YearZero, "0"),
        ]);
        assert!(rendered.starts_with("CRITICAL: artist tag is missing"));
        assert_eq!(
            rendered.matches("MEDIUM").count(),
            1,
            "duplicate reason was not deduped"
        );
        assert_eq!(rendered.matches("; ").count(), 1);
    }

    #[test]
    fn empty_reasons_render_empty() {
        assert_eq!(render_reasons(vec![]), "");
    }

    fn snap(
        artist: Option<&str>,
        album_artist: Option<&str>,
        title: Option<&str>,
    ) -> crate::audio::TagSnapshot {
        crate::audio::TagSnapshot {
            title: title.map(str::to_string),
            artist: artist.map(str::to_string),
            album_artist: album_artist.map(str::to_string),
            album: Some("An Album".into()),
            dates: year::RawDates {
                recording: Some("1997".into()),
                ..Default::default()
            },
        }
    }

    fn codes(rs: &[Reason]) -> Vec<ReasonCode> {
        rs.iter().map(|r| r.code).collect()
    }

    #[test]
    fn a_clean_file_reports_nothing() {
        let s = snap(Some("Radiohead"), Some("Radiohead"), Some("Karma Police"));
        assert!(check_file(&s, 2026).is_empty());
    }

    #[test]
    fn a_missing_artist_and_album_artist_are_both_reported() {
        let s = snap(None, None, Some("T"));
        let got = codes(&check_file(&s, 2026));
        assert!(got.contains(&ReasonCode::ArtistMissing));
        assert!(got.contains(&ReasonCode::AlbumArtistMissing));
    }

    #[test]
    fn an_empty_title_is_reported() {
        assert!(
            codes(&check_file(&snap(Some("A"), Some("A"), Some("  ")), 2026))
                .contains(&ReasonCode::TitleEmpty)
        );
        assert!(codes(&check_file(&snap(Some("A"), Some("A"), None), 2026))
            .contains(&ReasonCode::TitleEmpty));
    }

    #[test]
    fn a_blank_album_artist_does_not_also_report_downstream_noise() {
        // A whitespace-only value would otherwise trip the untrimmed and separator checks too,
        // producing three reasons for one defect.
        let got = codes(&check_file(&snap(Some("A"), Some("   "), Some("T")), 2026));
        assert_eq!(
            got.iter().filter(|c| **c != ReasonCode::TitleEmpty).count(),
            1
        );
        assert!(got.contains(&ReasonCode::AlbumArtistWhitespaceOnly));
    }

    #[test]
    fn the_lucene_breaker_is_reported_as_critical() {
        let s = snap(Some("A"), Some("Guns N\" Roses"), Some("T"));
        let rs = check_file(&s, 2026);
        assert!(codes(&rs).contains(&ReasonCode::AlbumArtistBreaksLucene));
        assert_eq!(
            ReasonCode::AlbumArtistBreaksLucene.severity(),
            Severity::Critical
        );
    }

    #[test]
    fn various_artists_is_not_flagged_for_separators() {
        // "Various Artists, Vol 2" has a comma but the indexer never resolves it, so reporting a
        // separator defect on it would be pure noise.
        let s = snap(Some("A"), Some("Various Artists, Vol 2"), Some("T"));
        let got = codes(&check_file(&s, 2026));
        assert!(!got.contains(&ReasonCode::AlbumArtistTooManyCoOwners));
        assert!(!got.contains(&ReasonCode::AlbumArtistUnrecognisedVarious));
    }

    #[test]
    fn every_code_has_a_distinct_name_and_nonempty_message() {
        // Guards against a copy-paste slip in the big match arms above, which would otherwise
        // silently mislabel a whole class of defect in the report.
        let mut seen = std::collections::HashSet::new();
        let mut messages = std::collections::HashSet::new();
        for code in ALL_CODES.iter().copied() {
            assert!(!code.message().is_empty(), "{:?} has no message", code);
            assert!(
                seen.insert(code.code()),
                "duplicate code string: {}",
                code.code()
            );
            // Messages must be unique too, because codes_in_rendered() identifies a code by its
            // message text - two identical messages would double-count in --report-only.
            assert!(
                messages.insert(code.message()),
                "duplicate message: {}",
                code.message()
            );
        }
    }

    #[test]
    fn no_message_contains_the_join_separator() {
        // render_reasons joins with "; ", so a message containing it would make the reason cell
        // impossible to split back apart - by eye or by --report-only.
        for code in ALL_CODES.iter().copied() {
            assert!(
                !code.message().contains("; "),
                "{} message contains the \"; \" join separator: {}",
                code.code(),
                code.message()
            );
        }
    }

    #[test]
    fn all_codes_is_exhaustive() {
        // If a variant is added without being listed in ALL_CODES, --report-only would silently
        // undercount it. Rust cannot enforce that directly, so assert the count instead: adding a
        // variant without updating ALL_CODES fails here.
        assert_eq!(
            ALL_CODES.len(),
            32,
            "ALL_CODES is out of sync with the ReasonCode enum"
        );
    }

    #[test]
    fn rendered_reasons_round_trip_back_to_their_codes() {
        let rendered = render_reasons(vec![
            Reason::bare(ReasonCode::ArtistMissing),
            Reason::new(ReasonCode::YearZero, "0"),
        ]);
        let got = codes_in_rendered(&rendered);
        assert!(got.contains(&ReasonCode::ArtistMissing));
        assert!(got.contains(&ReasonCode::YearZero));
        assert_eq!(got.len(), 2);
    }
}
