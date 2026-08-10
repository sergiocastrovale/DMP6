//! Artist-name resolution: turn one raw tag string into the list of artists it actually names.
//!
//! The rule this file exists to enforce: **a separator is never evidence of a split.** Real artists
//! are named "Nurse With Wound", "MAN WITH A MISSION", "Mumford & Sons", "Earth, Wind & Fire". Blindly
//! splitting on punctuation destroys them - measured against production data, 721 of 722 distinct
//! `" with "` tag values were being split, including four bands that own releases in this library.
//!
//! So: ask MusicBrainz whether the whole string is an artist. Only if it definitively is not do we
//! consider splitting, and every candidate grouping is validated the same way.
//!
//! Search order (cheapest first - most names never reach the network):
//!   0. embedded multi-value tags (`Artists` + `MusicBrainzArtistId` pairs) - authoritative, free
//!   1. cache / an artist already known with this name
//!   2. the whole string, as one artist
//!   3. contiguous-span recursion over separator positions, memoized
//!   4. fallback: treat the atoms as artists (unverified), minus role-fragments
//!
//! A transient network failure yields `Deferred`, never a guess - a blip must not permanently shred a
//! real band name.

use std::collections::HashMap;

use super::names::normalize_name;
use crate::artists::{is_known_single_artist, is_special_artist_name};

/// Beyond this many separators a name is pathological (credit dumps like "A with B, C, D or E, F,
/// G"); the O(n^2) span search would still terminate but spends real API budget on middles that never
/// match. Try the whole string and the atoms, skip the middles.
pub const MAX_SPAN_SEPARATORS: usize = 8;

/// Above this many co-billed parts, an albumArtist is a *personnel list*, not a collaboration. Real
/// data: `"Frank Sinatra, Buddy DeFranco, Marshall Sosson, ... , Nelson Riddle"` - 44 session
/// musicians, every one a genuine MusicBrainz artist. Treating those as co-owners would put a Sinatra
/// album on 44 browse pages. The first is the artist; the rest are credits.
pub const MAX_CO_OWNERS: usize = 4;

/// Demote everyone past the first to a credit when the list is too long to be genuine co-billing.
/// Applied to album artists only - a track's `artist` tag produces credits anyway.
pub fn cap_co_owners(parts: &mut [ResolvedArtist]) {
    let owners = parts
        .iter()
        .filter(|p| p.role == JoinKind::CoBilling)
        .count();
    if owners > MAX_CO_OWNERS {
        for part in parts.iter_mut().skip(1) {
            part.role = JoinKind::Guest;
        }
    }
}

/// How a tag's parts relate to each other, which decides ownership of a release.
///
/// Mirrors MusicBrainz artist-credit join phrases and Spotify's `album_group` distinction between an
/// artist's own discography and `appears_on`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinKind {
    /// "A & B", "A, B", "A / B", "A and B", "A vs B" - co-billing. Everyone owns the release.
    CoBilling,
    /// "A with B", "A feat. B", "A ft. B" - A owns the release, B is credited on the track.
    Guest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedArtist {
    pub name: String,
    pub mbid: Option<String>,
    /// True when MusicBrainz (or an embedded MB id) confirmed this name is a real artist. Only
    /// verified artists may be created as credit-only rows; unverified fallback atoms must not be.
    pub verified: bool,
    /// `CoBilling` => this part owns the release. `Guest` => this part is a track credit only.
    /// The first part of a guest-joined name is always the owner.
    pub role: JoinKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Resolved(Vec<ResolvedArtist>),
    /// MusicBrainz was unreachable while deciding this name. The caller must leave the name alone and
    /// retry on a later run rather than fall through to splitting.
    Deferred,
}

/// One lookup outcome, decoupled from the HTTP client so the resolver is unit-testable offline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupResult {
    /// MB knows this exact name (normalized/alias match).
    Found { mbid: Option<String> },
    /// MB definitively does not know it.
    NotFound,
    /// Network/timeout/503 - unknown, do not treat as NotFound.
    Transient,
    /// Not in the caller's cache yet. The search algorithm is synchronous (so it stays unit-testable
    /// with no network), while the actual lookup is async; the driver answers `NeedsFetch`, the search
    /// aborts exactly as it would for a transient error, and the driver fetches the name and retries.
    /// Kept distinct from `Transient` so a genuine outage is never mistaken for a cold cache.
    NeedsFetch,
}

/// Where a decision came from, for the `--dry-run` report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveSource {
    EmbeddedId,
    Cache,
    MbWhole,
    MbSpan,
    FallbackAtoms,
    Deferred,
}

impl ResolveSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EmbeddedId => "embedded-id",
            Self::Cache => "cache",
            Self::MbWhole => "mb-whole",
            Self::MbSpan => "mb-span",
            Self::FallbackAtoms => "fallback-atoms",
            Self::Deferred => "deferred",
        }
    }
}

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

/// A separator occurrence inside a name: the byte range it spans, and what it implies about roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Separator {
    pub start: usize,
    pub end: usize,
    pub kind: JoinKind,
}

/// Candidate separators, longest-first so " featuring " wins over " ft. " style prefixes and
/// " and " is not found inside a longer phrase.
const SEPARATOR_PATTERNS: &[(&str, JoinKind)] = &[
    (" featuring ", JoinKind::Guest),
    (" feat. ", JoinKind::Guest),
    (" feat ", JoinKind::Guest),
    (" ft. ", JoinKind::Guest),
    (" ft ", JoinKind::Guest),
    (" with ", JoinKind::Guest),
    (" vs. ", JoinKind::CoBilling),
    (" vs ", JoinKind::CoBilling),
    (" and ", JoinKind::CoBilling),
    (" & ", JoinKind::CoBilling),
    // Streetwear/collab-style billing: "Artist x Artist". Same risk profile as every other word-based
    // separator here (a real name could contain " x " as ordinary text) - the whole-string MB check
    // still runs first, so this only ever fires when that lookup has already failed.
    (" x ", JoinKind::CoBilling),
    ("; ", JoinKind::CoBilling),
    (", ", JoinKind::CoBilling),
    (" / ", JoinKind::CoBilling),
    (" \\ ", JoinKind::CoBilling),
    ("\\", JoinKind::CoBilling),
    ("|", JoinKind::CoBilling),
];

/// Find every candidate split point. Purely syntactic - proposes, never decides. A comma between two
/// digits ("10,000 Maniacs") is not a separator.
///
/// Matching is **ASCII**-case-insensitive, against the original bytes, and that is deliberate. Scanning
/// a `to_lowercase()` copy while recording offsets into the original is only correct while lowercasing
/// preserves byte length, and it does not: Turkish `İ` (U+0130, 2 bytes) lowercases to `i` + U+0307
/// (3 bytes). On `"İlhan Mimaroğlu; Freddie Hubbard Quintet"` the two strings drift apart and the scan
/// panics on a non-boundary slice - and before it panics, every offset it returns points into the wrong
/// place in the original, so the splits would have been silently wrong anyway.
///
/// Every pattern here is pure ASCII, so ASCII folding cannot miss one: for a full-Unicode lowering to
/// produce a pattern, some non-ASCII char would have to fold to an ASCII letter *and* land mid-pattern
/// ("Wİth" folds to "wi̇th", which is not "with"). An ASCII match at a char boundary also guarantees
/// `i + pat.len()` is a boundary, since ASCII bytes never appear inside a multi-byte sequence.
pub fn separator_positions(name: &str) -> Vec<Separator> {
    let bytes = name.as_bytes();
    let mut found: Vec<Separator> = Vec::new();
    let mut i = 0usize;

    'outer: while i < bytes.len() {
        if !name.is_char_boundary(i) {
            i += 1;
            continue;
        }
        for (pat, kind) in SEPARATOR_PATTERNS {
            let p = pat.as_bytes();
            if bytes.len() - i >= p.len() && bytes[i..i + p.len()].eq_ignore_ascii_case(p) {
                // "10,000 Maniacs" - a comma wrapped in digits is part of the number.
                if *pat == ", " {
                    let prev_digit = i > 0 && bytes[i - 1].is_ascii_digit();
                    let next = i + pat.len();
                    let next_digit = next < bytes.len() && bytes[next].is_ascii_digit();
                    if prev_digit && next_digit {
                        i += 1;
                        continue 'outer;
                    }
                }
                found.push(Separator {
                    start: i,
                    end: i + pat.len(),
                    kind: *kind,
                });
                i += pat.len();
                continue 'outer;
            }
        }
        i += 1;
    }

    found
}

// ---------------------------------------------------------------------------
// Role fragments
// ---------------------------------------------------------------------------

/// Leading qualifier words left dangling on the right-hand side of a guest split
/// ("... with special guests Carey Bell"), stripped before the part is judged.
/// ASCII-case-insensitive against the original for the same reason as `separator_positions`: the
/// prefixes are ASCII, and comparing a lowercased copy while slicing the original is only sound while
/// lowercasing preserves byte length.
pub fn strip_role_qualifier(part: &str) -> &str {
    let trimmed = part.trim();
    let bytes = trimmed.as_bytes();
    for prefix in [
        "special guests ",
        "special guest ",
        "guests ",
        "guest ",
        "guest artists ",
        "artists ",
        "orchestra conducted by ",
        "orchestra directed by ",
        "arranged and conducted by ",
        "conducted by ",
        "directed by ",
    ] {
        let p = prefix.as_bytes();
        if bytes.len() >= p.len() && bytes[..p.len()].eq_ignore_ascii_case(p) {
            return trimmed[prefix.len()..].trim();
        }
    }
    trimmed
}

/// An atom that is a role description rather than an artist name. Only ever applied to atoms MB could
/// NOT confirm - a real band called "The Orchestra" still resolves via MB and is kept.
pub fn is_role_fragment(name: &str) -> bool {
    let n = normalize_name(name);
    if n.is_empty() {
        return true;
    }
    const ENSEMBLES: &[&str] = &[
        "orchestra",
        "trio",
        "band",
        "group",
        "quartet",
        "quintet",
        "sextet",
        "septet",
        "ensemble",
        "singers",
        "chorus",
        "choir",
        "strings",
    ];
    if ENSEMBLES.contains(&n.as_str()) {
        return true;
    }
    // "his orchestra", "her singing strings", "their band"
    let mut words = n.split_whitespace();
    if let Some(first) = words.next() {
        if matches!(first, "his" | "her" | "their") {
            if let Some(last) = n.split_whitespace().next_back() {
                return ENSEMBLES.contains(&last);
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

struct SpanResolver<'a, F: FnMut(&str) -> LookupResult> {
    lookup: F,
    memo: HashMap<(usize, usize), Option<Vec<ResolvedArtist>>>,
    seps: &'a [Separator],
    name: &'a str,
    transient: bool,
    pub lookups: usize,
}

impl<'a, F: FnMut(&str) -> LookupResult> SpanResolver<'a, F> {
    /// Resolve the span covering separators `[lo, hi)` - i.e. atoms `lo..=hi`. Returns `None` when no
    /// grouping of this span is fully MB-verified.
    fn resolve_span(&mut self, lo: usize, hi: usize) -> Option<Vec<ResolvedArtist>> {
        if let Some(cached) = self.memo.get(&(lo, hi)) {
            return cached.clone();
        }

        let text = self.span_text(lo, hi);
        let stripped = strip_role_qualifier(&text).to_string();

        // Coarsest first: is this whole span one artist?
        let whole = if stripped.is_empty() {
            LookupResult::NotFound
        } else {
            self.lookups += 1;
            (self.lookup)(&stripped)
        };
        match whole {
            LookupResult::Transient | LookupResult::NeedsFetch => {
                self.transient = true;
                self.memo.insert((lo, hi), None);
                return None;
            }
            LookupResult::Found { mbid } => {
                let out = vec![ResolvedArtist {
                    name: stripped,
                    mbid,
                    verified: true,
                    role: JoinKind::CoBilling,
                }];
                self.memo.insert((lo, hi), Some(out.clone()));
                return Some(out);
            }
            LookupResult::NotFound => {}
        }

        // Otherwise try every internal split point, keeping the join kind of the separator we cut at.
        let mut result: Option<Vec<ResolvedArtist>> = None;
        for mid in lo..hi {
            let left = self.resolve_span(lo, mid);
            if self.transient {
                self.memo.insert((lo, hi), None);
                return None;
            }
            let Some(left) = left else { continue };
            let right = self.resolve_span(mid + 1, hi);
            if self.transient {
                self.memo.insert((lo, hi), None);
                return None;
            }
            let Some(right) = right else { continue };

            let kind = self.seps[mid].kind;
            let mut combined = left;
            let right_role = match kind {
                // Everything to the right of a guest phrase is a credit.
                JoinKind::Guest => JoinKind::Guest,
                JoinKind::CoBilling => JoinKind::CoBilling,
            };
            for mut artist in right {
                if artist.role == JoinKind::CoBilling {
                    artist.role = right_role;
                }
                combined.push(artist);
            }
            result = Some(combined);
            break;
        }

        self.memo.insert((lo, hi), result.clone());
        result
    }

    fn span_text(&self, lo: usize, hi: usize) -> String {
        let start = if lo == 0 { 0 } else { self.seps[lo - 1].end };
        let end = if hi >= self.seps.len() {
            self.name.len()
        } else {
            self.seps[hi].start
        };
        self.name[start..end].trim().to_string()
    }
}

/// Resolve one raw tag value. `lookup` answers "does MusicBrainz know this exact name?" - the caller
/// supplies it so cache, HTTP and test stubs all plug in the same way.
pub fn resolve_with<F: FnMut(&str) -> LookupResult>(
    name: &str,
    mut lookup: F,
) -> (Resolution, ResolveSource) {
    let trimmed = name.trim();
    if trimmed.is_empty() || is_special_artist_name(trimmed) {
        return (
            Resolution::Resolved(Vec::new()),
            ResolveSource::FallbackAtoms,
        );
    }

    // Offline backstop, consulted BEFORE any split is contemplated: a band the codebase already knows
    // is one artist stays one artist even if MusicBrainz answers "no such artist" (a rename, an aliased
    // entry, a bad response). MB is still asked first for the id below; this only removes the split.
    if is_known_single_artist(trimmed) {
        let mbid = match lookup(trimmed) {
            LookupResult::Found { mbid } => mbid,
            _ => None,
        };
        return (
            Resolution::Resolved(vec![ResolvedArtist {
                name: trimmed.to_string(),
                mbid,
                verified: true,
                role: JoinKind::CoBilling,
            }]),
            ResolveSource::MbWhole,
        );
    }

    // Tier 2 - the whole string, before any thought of splitting.
    match lookup(trimmed) {
        LookupResult::Transient | LookupResult::NeedsFetch => {
            return (Resolution::Deferred, ResolveSource::Deferred)
        }
        LookupResult::Found { mbid } => {
            return (
                Resolution::Resolved(vec![ResolvedArtist {
                    name: trimmed.to_string(),
                    mbid,
                    verified: true,
                    role: JoinKind::CoBilling,
                }]),
                ResolveSource::MbWhole,
            );
        }
        LookupResult::NotFound => {}
    }

    let seps = separator_positions(trimmed);
    if seps.is_empty() {
        // No separators and MB doesn't know it: it is what it is, just unverified.
        return (
            Resolution::Resolved(vec![ResolvedArtist {
                name: trimmed.to_string(),
                mbid: None,
                verified: false,
                role: JoinKind::CoBilling,
            }]),
            ResolveSource::FallbackAtoms,
        );
    }

    // Tier 3 - memoized span search, unless the name is pathologically separated.
    if seps.len() <= MAX_SPAN_SEPARATORS {
        let mut resolver = SpanResolver {
            lookup: &mut lookup,
            memo: HashMap::new(),
            seps: &seps,
            name: trimmed,
            transient: false,
            lookups: 0,
        };
        let spanned = resolver.resolve_span(0, seps.len());
        if resolver.transient {
            return (Resolution::Deferred, ResolveSource::Deferred);
        }
        if let Some(parts) = spanned {
            return (
                Resolution::Resolved(assign_owner(parts)),
                ResolveSource::MbSpan,
            );
        }
    }

    // Tier 4 - nothing verified anywhere: the atoms are the artists.
    let mut atoms: Vec<ResolvedArtist> = Vec::new();
    let mut transient = false;
    for (idx, atom) in atom_texts(trimmed, &seps).into_iter().enumerate() {
        let atom = strip_role_qualifier(&atom).to_string();
        if atom.is_empty() {
            continue;
        }
        let role = if idx == 0 {
            JoinKind::CoBilling
        } else {
            seps[idx - 1].kind
        };
        match lookup(&atom) {
            LookupResult::Transient | LookupResult::NeedsFetch => {
                transient = true;
                break;
            }
            LookupResult::Found { mbid } => {
                atoms.push(ResolvedArtist {
                    name: atom,
                    mbid,
                    verified: true,
                    role,
                });
            }
            LookupResult::NotFound => {
                // Unverified - keep it as an artist per the fallback rule, unless it is plainly a role
                // description rather than a name.
                if !is_role_fragment(&atom) {
                    atoms.push(ResolvedArtist {
                        name: atom,
                        mbid: None,
                        verified: false,
                        role,
                    });
                }
            }
        }
    }
    if transient {
        return (Resolution::Deferred, ResolveSource::Deferred);
    }

    (
        Resolution::Resolved(assign_owner(atoms)),
        ResolveSource::FallbackAtoms,
    )
}

/// Resolve using ONLY what is already known locally - no network, ever.
///
/// Used by the folder scan, which must decide a release's owners immediately (they drive
/// `lastIndexedAt`, totals and the artist folder image) but cannot afford a 1.1 s/request stall per
/// folder. `lookup` answers from the cache/memo alone and returns `NeedsFetch` for anything unknown.
///
/// Returns `None` unless the answer is *confident*: the search must have finished without wanting a
/// fetch, and must not have come from the unverified atom fallback. That second condition is the
/// important one - with a cold cache every lookup is `NeedsFetch`, and without it a name like
/// "Kool & The Gang" would fall through to the atom fallback and be split offline with no evidence
/// whatsoever. The caller keeps the raw tag as a provisional owner instead, and the post-loop pass
/// fixes it once MusicBrainz can be asked.
pub fn resolve_offline<F: FnMut(&str) -> LookupResult>(
    name: &str,
    lookup: F,
) -> Option<Vec<ResolvedArtist>> {
    match resolve_with(name, lookup) {
        (Resolution::Resolved(parts), src)
            if src != ResolveSource::FallbackAtoms && !parts.is_empty() =>
        {
            Some(parts)
        }
        _ => None,
    }
}

/// The first part always owns the release; a guest-joined part never does.
fn assign_owner(mut parts: Vec<ResolvedArtist>) -> Vec<ResolvedArtist> {
    if let Some(first) = parts.first_mut() {
        first.role = JoinKind::CoBilling;
    }
    parts
}

fn atom_texts(name: &str, seps: &[Separator]) -> Vec<String> {
    let mut out = Vec::with_capacity(seps.len() + 1);
    let mut cursor = 0usize;
    for sep in seps {
        out.push(name[cursor..sep.start].trim().to_string());
        cursor = sep.end;
    }
    out.push(name[cursor..].trim().to_string());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Stub MB: only the listed names exist.
    fn known(names: &'static [&'static str]) -> impl FnMut(&str) -> LookupResult {
        move |q: &str| {
            if names.iter().any(|n| normalize_name(n) == normalize_name(q)) {
                LookupResult::Found {
                    mbid: Some(format!("mbid-{}", normalize_name(q))),
                }
            } else {
                LookupResult::NotFound
            }
        }
    }

    fn names_of(r: &Resolution) -> Vec<String> {
        match r {
            Resolution::Resolved(v) => v.iter().map(|a| a.name.clone()).collect(),
            Resolution::Deferred => vec!["<deferred>".to_string()],
        }
    }

    #[test]
    fn whole_string_hit_never_splits() {
        // The bug this refactor exists to kill: real bands whose names contain separator words.
        for band in [
            "Nurse With Wound",
            "MAN WITH A MISSION",
            "Dance With the Dead",
            "Ends With A Bullet",
        ] {
            let (res, src) = resolve_with(
                band,
                known(&[
                    "Nurse With Wound",
                    "MAN WITH A MISSION",
                    "Dance With the Dead",
                    "Ends With A Bullet",
                ]),
            );
            assert_eq!(names_of(&res), vec![band.to_string()], "{band} was split");
            assert_eq!(src, ResolveSource::MbWhole);
        }
    }

    #[test]
    fn known_band_survives_inside_a_longer_credit() {
        // "Mumford & Sons with Baaba Maal" - the band must stay whole, the guest split off.
        let (res, src) = resolve_with(
            "Mumford & Sons with Baaba Maal",
            known(&["Mumford & Sons", "Baaba Maal"]),
        );
        assert_eq!(names_of(&res), vec!["Mumford & Sons", "Baaba Maal"]);
        assert_eq!(src, ResolveSource::MbSpan);
        match res {
            Resolution::Resolved(parts) => {
                assert_eq!(
                    parts[0].role,
                    JoinKind::CoBilling,
                    "the band owns the release"
                );
                assert_eq!(parts[1].role, JoinKind::Guest, "the guest is credit-only");
            }
            _ => panic!("expected Resolved"),
        }
    }

    #[test]
    fn prefers_the_coarsest_valid_grouping() {
        // "Y & Z with A" where MB knows the duo "Y & Z" - must not shred it into Y + Z + A.
        let (res, _) = resolve_with("Y & Z with A", known(&["Y & Z", "A"]));
        assert_eq!(names_of(&res), vec!["Y & Z", "A"]);
    }

    #[test]
    fn guest_phrase_makes_owner_and_credit() {
        let (res, _) = resolve_with(
            "Frank Sinatra with Count Basie",
            known(&["Frank Sinatra", "Count Basie"]),
        );
        match res {
            Resolution::Resolved(parts) => {
                assert_eq!(parts.len(), 2);
                assert_eq!(parts[0].name, "Frank Sinatra");
                assert_eq!(parts[0].role, JoinKind::CoBilling);
                assert_eq!(parts[1].name, "Count Basie");
                assert_eq!(parts[1].role, JoinKind::Guest);
            }
            _ => panic!("expected Resolved"),
        }
    }

    #[test]
    fn co_billing_makes_everyone_an_owner() {
        // Riding With the King - a genuine 50/50 album.
        let (res, _) = resolve_with(
            "B.B. King & Eric Clapton",
            known(&["B.B. King", "Eric Clapton"]),
        );
        match res {
            Resolution::Resolved(parts) => {
                assert_eq!(parts.len(), 2);
                assert!(parts.iter().all(|p| p.role == JoinKind::CoBilling));
            }
            _ => panic!("expected Resolved"),
        }
    }

    #[test]
    fn and_is_a_separator_now() {
        // Previously unsplittable: " and " was not in the separator set at all.
        let (res, _) = resolve_with(
            "Frank Sinatra and Count Basie",
            known(&["Frank Sinatra", "Count Basie"]),
        );
        assert_eq!(names_of(&res), vec!["Frank Sinatra", "Count Basie"]);
    }

    #[test]
    fn x_is_a_separator_now() {
        // Streetwear/collab-style billing: "Artist x Artist". Previously unsplittable.
        let (res, _) = resolve_with("Travis Scott x The Weeknd", known(&["Travis Scott", "The Weeknd"]));
        assert_eq!(names_of(&res), vec!["Travis Scott", "The Weeknd"]);
    }

    #[test]
    fn all_miss_falls_back_to_atoms_unverified() {
        let (res, src) = resolve_with("A & B", known(&[]));
        assert_eq!(src, ResolveSource::FallbackAtoms);
        match res {
            Resolution::Resolved(parts) => {
                assert_eq!(
                    names_of(&Resolution::Resolved(parts.clone())),
                    vec!["A", "B"]
                );
                assert!(
                    parts.iter().all(|p| !p.verified),
                    "fallback atoms are unverified"
                );
            }
            _ => panic!("expected Resolved"),
        }
    }

    #[test]
    fn drops_role_fragments_only_when_unverified() {
        let (res, _) = resolve_with(
            "Frank Sinatra with Gordon Jenkins & His Orchestra",
            known(&["Frank Sinatra", "Gordon Jenkins"]),
        );
        let names = names_of(&res);
        assert!(names.contains(&"Frank Sinatra".to_string()));
        assert!(names.contains(&"Gordon Jenkins".to_string()));
        assert!(
            !names
                .iter()
                .any(|n| n.eq_ignore_ascii_case("His Orchestra")),
            "got {names:?}"
        );
    }

    #[test]
    fn strips_qualifier_before_judging() {
        let (res, _) = resolve_with(
            "The Eddie Taylor Blues Band with special guests Carey Bell & Sunnyland Slim",
            known(&[
                "The Eddie Taylor Blues Band",
                "Carey Bell",
                "Sunnyland Slim",
            ]),
        );
        assert_eq!(
            names_of(&res),
            vec![
                "The Eddie Taylor Blues Band",
                "Carey Bell",
                "Sunnyland Slim"
            ],
        );
    }

    #[test]
    fn numeric_comma_is_not_a_separator() {
        assert!(separator_positions("10,000 Maniacs").is_empty());
        let (res, _) = resolve_with("10,000 Maniacs", known(&[]));
        assert_eq!(names_of(&res), vec!["10,000 Maniacs"]);
    }

    #[test]
    fn a_dotted_capital_i_does_not_panic_or_shift_the_offsets() {
        // The exact tag that killed a resolve run at [4861/34850]:
        //   "start byte index 2 is not a char boundary; it is inside '\u{307}'"
        // Turkish İ (U+0130, 2 bytes) lowercases to i + U+0307 (3 bytes), so a scan over a lowercased
        // copy drifts out of alignment with the original it records offsets into.
        let name = "İlhan Mimaroğlu; Freddie Hubbard Quintet";
        let seps = separator_positions(name);
        assert_eq!(seps.len(), 1, "the '; ' between the two artists");

        // The offsets must address the ORIGINAL string - before the fix they addressed the lowercased
        // copy, so even without the panic the split would have sliced the wrong bytes.
        let sep = &seps[0];
        assert_eq!(&name[..sep.start], "İlhan Mimaroğlu");
        assert_eq!(&name[sep.end..], "Freddie Hubbard Quintet");

        // Every offset is a valid char boundary, so slicing can never panic downstream.
        for s in &seps {
            assert!(name.is_char_boundary(s.start) && name.is_char_boundary(s.end));
        }
    }

    #[test]
    fn separator_matching_stays_case_insensitive_for_ascii() {
        // ASCII folding replaced to_lowercase(); word separators must still match in any case.
        for variant in ["A FEAT. B", "A Feat. B", "A feat. B"] {
            assert_eq!(separator_positions(variant).len(), 1, "{variant}");
        }
        assert_eq!(strip_role_qualifier("CONDUCTED BY Nelson Riddle"), "Nelson Riddle");
        assert_eq!(strip_role_qualifier("Special Guests Carey Bell"), "Carey Bell");
    }

    #[test]
    fn non_ascii_names_survive_the_role_qualifier_strip() {
        // Same offset hazard, same fix - a name that lowercases to a different byte length must come
        // back untouched rather than sliced at a stale offset.
        assert_eq!(strip_role_qualifier("İlhan Mimaroğlu"), "İlhan Mimaroğlu");
        assert_eq!(strip_role_qualifier("Ğğ Şş Çç"), "Ğğ Şş Çç");
    }

    #[test]
    fn transient_defers_and_never_guesses() {
        // Deliberately a name the offline backstop does not cover, so this exercises the network path.
        let (res, src) = resolve_with("Some Band With Words", |_| LookupResult::Transient);
        assert_eq!(res, Resolution::Deferred);
        assert_eq!(src, ResolveSource::Deferred);
    }

    #[test]
    fn transient_midway_still_defers() {
        // Whole-string misses, then the network dies during the span search: must NOT fall through to
        // the atom fallback, or a blip permanently splits a real band.
        let mut calls = 0;
        let (res, _) = resolve_with("Some Band With Words", |_| {
            calls += 1;
            if calls == 1 {
                LookupResult::NotFound
            } else {
                LookupResult::Transient
            }
        });
        assert_eq!(res, Resolution::Deferred);
    }

    #[test]
    fn span_search_is_memoized_not_exponential() {
        // 4 separators => 2^4 = 16 subsets brute-force, but only 5*6/2 = 15 contiguous spans, each
        // queried once. Assert we stay in the quadratic regime rather than the exponential one.
        let mut lookups = 0usize;
        let _ = resolve_with("A & B & C & D & E", |_| {
            lookups += 1;
            LookupResult::NotFound
        });
        assert!(lookups <= 25, "span search made {lookups} lookups");
    }

    #[test]
    fn pathological_names_skip_the_middle_spans() {
        let name = "A, B, C, D, E, F, G, H, I, J, K";
        assert!(separator_positions(name).len() > MAX_SPAN_SEPARATORS);
        let mut lookups = 0usize;
        let (res, src) = resolve_with(name, |_| {
            lookups += 1;
            LookupResult::NotFound
        });
        assert_eq!(src, ResolveSource::FallbackAtoms);
        assert_eq!(names_of(&res).len(), 11);
        assert!(lookups <= 13, "expected whole + atoms only, got {lookups}");
    }

    #[test]
    fn real_library_names_that_used_to_be_shredded() {
        // Every one of these is a real artist that owns releases in the production library, and every
        // one was being split by the old punctuation-guessing splitter (measured: 721 of 722 distinct
        // " with " values were split). MB knows them, so they must survive whole.
        let catalogue: &'static [&'static str] = &[
            "Nurse With Wound",
            "MAN WITH A MISSION",
            "Dance With the Dead",
            "Ends With A Bullet",
            "Mumford & Sons",
            "King Gizzard & the Lizard Wizard",
            "Earth, Wind & Fire",
            "Simon & Garfunkel",
            "10,000 Maniacs",
            "AC/DC",
        ];
        for name in catalogue {
            let (res, _) = resolve_with(name, known(catalogue));
            assert_eq!(names_of(&res), vec![name.to_string()], "{name} was split");
        }
    }

    #[test]
    fn compound_credits_from_the_real_library_split_correctly() {
        // ...while genuine compounds around those same names still separate.
        let known_artists: &'static [&'static str] = &[
            "Mumford & Sons",
            "Baaba Maal",
            "King Gizzard & the Lizard Wizard",
            "Mild High Club",
            "Nurse With Wound",
            "Cyclobe",
            "Faust",
        ];
        let (res, _) = resolve_with("Mumford & Sons with Baaba Maal", known(known_artists));
        assert_eq!(names_of(&res), vec!["Mumford & Sons", "Baaba Maal"]);

        let (res, _) = resolve_with(
            "King Gizzard & the Lizard Wizard with Mild High Club",
            known(known_artists),
        );
        assert_eq!(
            names_of(&res),
            vec!["King Gizzard & the Lizard Wizard", "Mild High Club"]
        );

        let (res, _) = resolve_with("Nurse With Wound & Cyclobe", known(known_artists));
        assert_eq!(names_of(&res), vec!["Nurse With Wound", "Cyclobe"]);

        let (res, _) = resolve_with("Faust & Nurse With Wound", known(known_artists));
        assert_eq!(names_of(&res), vec!["Faust", "Nurse With Wound"]);
    }

    #[test]
    fn bare_backslash_splits() {
        // Real library values: "B.B. King\\Bobby Bland", "Joan Baez\\Mimi Farina" - no spaces around it.
        let (res, _) = resolve_with(
            "B.B. King\\Bobby Bland",
            known(&["B.B. King", "Bobby Bland"]),
        );
        assert_eq!(names_of(&res), vec!["B.B. King", "Bobby Bland"]);
    }

    #[test]
    fn long_personnel_lists_keep_one_owner() {
        // A 6-name comma list is a personnel credit, not a 6-way co-billing. Everyone past the first
        // becomes a credit so the album does not surface on six browse pages.
        let names: &'static [&'static str] = &["A", "B", "C", "D", "E", "F"];
        let (res, _) = resolve_with("A, B, C, D, E, F", known(names));
        let mut parts = match res {
            Resolution::Resolved(p) => p,
            _ => panic!("expected Resolved"),
        };
        assert_eq!(parts.len(), 6);
        cap_co_owners(&mut parts);
        assert_eq!(parts[0].role, JoinKind::CoBilling, "first stays the owner");
        assert!(
            parts[1..].iter().all(|p| p.role == JoinKind::Guest),
            "rest become credits"
        );

        // A genuine pair is untouched.
        let (res, _) = resolve_with("A & B", known(names));
        let mut pair = match res {
            Resolution::Resolved(p) => p,
            _ => panic!("expected Resolved"),
        };
        cap_co_owners(&mut pair);
        assert!(
            pair.iter().all(|p| p.role == JoinKind::CoBilling),
            "a duo still co-owns"
        );
    }

    #[test]
    fn traced_hostile_names_stay_whole() {
        // The four names walked through by hand. Two are structurally unsplittable (no separator is
        // even found); two carry a separator and depend on the lookup - all four must stay whole.
        let catalogue: &'static [&'static str] = &[
            "AC/DC",
            "Kool & The Gang",
            "Florence + The Machine",
            "Tom Petty and the Heartbreakers",
        ];
        for name in catalogue {
            let (res, _) = resolve_with(name, known(catalogue));
            assert_eq!(names_of(&res), vec![name.to_string()], "{name} was split");
        }
    }

    #[test]
    fn no_separator_is_even_found_for_slash_or_plus_names() {
        // AC/DC and Florence + The Machine cannot be split even in principle: bare "/" is not a
        // separator (only " / " is) and "+" is not one at all. They survive a total MB blackout.
        assert!(separator_positions("AC/DC").is_empty());
        assert!(separator_positions("Florence + The Machine").is_empty());
        for name in ["AC/DC", "Florence + The Machine"] {
            let (res, _) = resolve_with(name, |_| LookupResult::NotFound);
            assert_eq!(names_of(&res), vec![name.to_string()]);
        }
    }

    #[test]
    fn backstop_saves_known_bands_when_mb_says_not_found() {
        // These two DO have a candidate split, so without the offline backstop a definitive NotFound
        // would shred them. MB is still asked (for the id); only the split is suppressed.
        for name in [
            "Kool & The Gang",
            "Tom Petty and the Heartbreakers",
            "AC/DC",
        ] {
            let (res, _) = resolve_with(name, |_| LookupResult::NotFound);
            assert_eq!(
                names_of(&res),
                vec![name.to_string()],
                "{name} split despite the backstop"
            );
        }
    }

    #[test]
    fn backstop_matches_punctuation_variants() {
        // One list entry covers every punctuation spelling of the same band.
        assert!(crate::artists::is_known_single_artist(
            "Florence + the Machine"
        ));
        assert!(crate::artists::is_known_single_artist(
            "Florence & The Machine"
        ));
        assert!(crate::artists::is_known_single_artist(
            "tom petty & the heartbreakers"
        ));
        assert!(!crate::artists::is_known_single_artist("Florence"));
    }

    #[test]
    fn cold_cache_refuses_to_decide_rather_than_splitting() {
        // The folder scan resolves offline. With a cold cache every lookup answers NeedsFetch, and the
        // ONLY safe answer is "I don't know" - falling through to the atom fallback here would split
        // real bands with no evidence at all, offline, before MusicBrainz is ever consulted.
        // Names the backstop does NOT cover - the real danger class.
        for name in [
            "Ella Fitzgerald & Joe Pass",
            "Some Duo & Another Act",
            "A Band and Another Band",
        ] {
            assert!(
                resolve_offline(name, |_| LookupResult::NeedsFetch).is_none(),
                "{name} must not be resolved offline from a cold cache"
            );
        }

        // A backstopped band is the deliberate exception: it resolves offline as ONE artist, which is
        // the whole point of the backstop - it can never be split, cache or no cache.
        let kool = resolve_offline("Kool & The Gang", |_| LookupResult::NeedsFetch)
            .expect("backstop decides offline");
        assert_eq!(kool.len(), 1);
        assert_eq!(kool[0].name, "Kool & The Gang");
    }

    #[test]
    fn warm_cache_resolves_offline_without_any_fetch() {
        // Once the cache knows the pieces, the same name resolves with zero network calls - this is
        // what lets an incremental run create the right owners directly instead of a compound.
        let cached: &'static [&'static str] = &["Ella Fitzgerald", "Roy Eldridge Sextet"];
        let parts = resolve_offline("Ella Fitzgerald & Roy Eldridge Sextet", known(cached))
            .expect("a warm cache should resolve this offline");
        assert_eq!(
            parts.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
            vec!["Ella Fitzgerald", "Roy Eldridge Sextet"],
        );

        // A band the cache knows as ONE artist stays whole.
        let whole = resolve_offline("Kool & The Gang", known(&["Kool & The Gang"]))
            .expect("cached whole-name hit");
        assert_eq!(whole.len(), 1);

        // The backstop also works offline, with no cache at all.
        let backstopped = resolve_offline("AC/DC", |_| LookupResult::NeedsFetch)
            .expect("backstop should decide offline");
        assert_eq!(backstopped.len(), 1);
    }

    #[test]
    fn special_artist_names_never_reach_lookup() {
        let (res, _) = resolve_with("Various Artists", |_| panic!("must not query MB"));
        assert_eq!(names_of(&res), Vec::<String>::new());
    }
}
