//! Box-set binding: matches sibling disc folders index left unmerged (index never folds,
//! docs/multidisk.md §4) to a box's *media* by tracklist, since MusicBrainz box sets don't carry the
//! id discipline plain multi-disc detection relies on. Two shapes handled identically:
//!
//!   (a) one disc mis-tagged as the standalone album (embedded ids disjoint, not unanimous)
//!   (b) every disc tagged as its own standalone album (embedded ids differ entirely, and often
//!       every sibling reads discNumber=1 since no file was ever told it was part of a box)
//!
//! MusicBrainz has no box-set entity: a box is one Release with N media, and MB stores no link from
//! a box's disc to the standalone release it duplicates - the only shared identity is the recording
//! (docs/multidisk.md §1). This module matches siblings to *media* by tracklist, never by any id the
//! files carry, and accepts only a **perfect matching**: every sibling maps to exactly one medium,
//! with equal track count and every track's title+duration (±5s) agreeing - the same rule
//! `owned::find_owning_bundle` uses for the bonus-disc case. Any ambiguity rejects the whole group; a
//! box with some discs not owned at all is fine (a partial match), a box where a disc could equally
//! be two different media is not.
//!
//! Binding a box is only half the job: `run_repair` also decides, once equivalences are known, fold
//! (genuine multi-disc release) or dissolve (box set) - docs/multidisk.md §3/§5.

use std::collections::{HashMap, HashSet};

use crate::box_editions;
use crate::db::*;
use crate::mb_api::{self, RateLimiter};
use crate::owned::{durations_compatible, normalize_title};
use chrono::Utc;
use colored::Colorize;
use common::mb::types::{MbMedia, MbRelease};
use common::progress::Reporter;
use reqwest::Client;
use sqlx::PgPool;

// ---------------------------------------------------------------------------
// Pure decision logic - no network, no DB. See `plan_box_bind`.
// ---------------------------------------------------------------------------

/// One sibling folder tier 1 left unmerged, with its own local tracklist in track order.
/// `(LocalReleaseTrack.id, title, duration secs)` - order matters, since a medium's tracks are
/// compared positionally, not by fuzzy title search (unlike `owned::find_owning_bundle`, which
/// searches because a bonus disc's tracks are scattered inside a bigger folder; here each candidate
/// medium is already exactly one folder's worth of tracks, so position order is meaningful and a
/// content match is much stronger evidence than an unordered one).
#[derive(Debug, Clone)]
pub struct BoxSibling {
    pub local_id: String,
    pub folder_path: String,
    pub tracks: Vec<(String, String, Option<i32>)>,
}

/// One medium of a candidate MB release, tracklist in position order.
/// `(MB track id (raw MusicBrainz UUID), title, duration secs)`.
#[derive(Debug, Clone)]
pub struct BoxMedium {
    pub position: i32,
    pub tracks: Vec<(String, String, Option<i32>)>,
}

/// A release MusicBrainz considers a single Release with N media - the box itself.
#[derive(Debug, Clone)]
pub struct BoxCandidate {
    pub release_id: String,
    pub media: Vec<BoxMedium>,
}

pub struct BoxBindPlan {
    pub release_id: String,
    pub folder_path: String,
    pub survivor: String,
    pub absorbed: Vec<String>,
    /// (local_id, medium position) for every sibling, survivor included.
    pub members: Vec<(String, i32)>,
    /// (local track id, MB track raw UUID) across every matched sibling, for relinking
    /// `LocalReleaseTrack.mbTrackId` once the candidate's tracks are persisted.
    pub track_links: Vec<(String, String)>,
}

fn common_ancestor(a: &str, b: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for (sa, sb) in a.split('/').zip(b.split('/')) {
        if sa != sb {
            break;
        }
        out.push(sa);
    }
    out.join("/")
}

/// Pair a folder's tracks against a medium's, one-to-one, returning `(local_track_id, mb_track_id)`
/// for every track - or `None` when the two are not the same tracklist.
///
/// Same length is still required (this decides "is this folder *that* disc", not containment), but the
/// pairing is by **content, not position**: each local track claims a distinct medium track with the
/// same normalized title and a compatible duration, in any order.
///
/// Order used to be load-bearing - the two lists were `zip`ped - and that silently rejected real
/// boxes. ABBA's "The Complete Studio Recordings (9CD)" is a perfect 9-of-9 rip whose disc 1 carries
/// exactly MusicBrainz's 19 tracks, but sequenced differently ("Åh, vilka tider" 3rd locally vs 14th
/// in MB, "Rock 'n Roll Band" last vs 12th). One such disc made `plan_box_bind` reject the **whole**
/// group, so a complete box stayed nine unbound `MISSING_TRACKS` folders.
///
/// Greedy first-fit, matching `owned::find_owning_bundle`'s own approach: duration separates
/// same-titled tracks, and a pathological set where only a different assignment would succeed is
/// left unmatched rather than guessed at.
fn pair_tracks(
    local: &[(String, String, Option<i32>)],
    medium: &[(String, String, Option<i32>)],
) -> Option<Vec<(String, String)>> {
    if local.len() != medium.len() {
        return None;
    }
    let mut available: Vec<(usize, String, Option<i32>)> = medium
        .iter()
        .enumerate()
        .map(|(i, (_, title, secs))| (i, normalize_title(title), *secs))
        .collect();

    let mut links: Vec<(String, String)> = Vec::with_capacity(local.len());
    let mut unresolved: Vec<(&String, String, Option<i32>)> = Vec::new();

    // Pass 1 - identical title, runtimes agreeing closely. Everything placeable beyond doubt is
    // placed first, so the looser passes never compete for a track this one had a claim on. Greedy is
    // correct here: two tracks that share a title *and* a runtime are interchangeable.
    for (local_id, local_title, local_secs) in local {
        let want = normalize_title(local_title);
        match available
            .iter()
            .position(|(_, have, hs)| *have == want && durations_compatible(*local_secs, *hs))
        {
            Some(pos) => {
                let (idx, _, _) = available.remove(pos);
                links.push((local_id.clone(), medium[idx].0.clone()));
            }
            None => unresolved.push((local_id, want, *local_secs)),
        }
    }

    // Pass 1b - identical title, runtime merely in the same region. Rips, masterings and gapless
    // trailing silence move a track by a few seconds, and the five-second tie-breaker used above is
    // deliberately tight because `owned::find_owning_bundle` shares it for a much weaker test.
    // Requiring it here cost ABBA's "The Complete Studio Recordings" its entire nine-disc bind over
    // one track: disc 5's "I'm a Marionette" is 243s in the files against MusicBrainz's 249s, on a
    // disc whose eleven titles otherwise line up exactly.
    //
    // Still bounded, because a shared title with a wildly different runtime is usually a different
    // recording - a live take, an extended mix - not a different rip of the same one.
    const SAME_TRACK_DIFFERENT_MASTER_SECS: i32 = 15;
    let mut still_unresolved: Vec<(&String, String, Option<i32>)> = Vec::new();
    for (local_id, want, local_secs) in unresolved {
        let near = |hs: Option<i32>| match (local_secs, hs) {
            (Some(a), Some(b)) => (a - b).abs() <= SAME_TRACK_DIFFERENT_MASTER_SECS,
            _ => true,
        };
        match available
            .iter()
            .position(|(_, have, hs)| *have == want && near(*hs))
        {
            Some(pos) => {
                let (idx, _, _) = available.remove(pos);
                links.push((local_id.clone(), medium[idx].0.clone()));
            }
            None => still_unresolved.push((local_id, want, local_secs)),
        }
    }
    let unresolved = still_unresolved;

    // Pass 2 - a title that merely *contains* the other, for the leftovers. Tags routinely qualify a
    // track MusicBrainz leaves plain, or the reverse: ABBA's "The Complete Studio Recordings" disc 1
    // is a perfect 19-of-19 rip whose opener is tagged "Ring Ring (English version)" where
    // MusicBrainz says "Ring Ring", and that single word rejected the entire nine-disc box.
    //
    // Only for leftovers, and only when exactly one candidate fits. Run greedily over every track it
    // would be actively dangerous: that same disc also holds the Spanish, German and Swedish "Ring
    // Ring", whose durations sit within the tolerance of the plain one - first-fit would happily pair
    // whichever came first. Exact-first plus a uniqueness test removes both hazards.
    for (local_id, want, local_secs) in unresolved {
        let mut hits = available.iter().enumerate().filter(|(_, (_, have, hs))| {
            (have.contains(want.as_str()) || want.contains(have.as_str()))
                && durations_compatible(local_secs, *hs)
        });
        let (pos, _) = hits.next()?;
        if hits.next().is_some() {
            return None; // ambiguous - refuse rather than guess
        }
        let (idx, _, _) = available.remove(pos);
        links.push((local_id.clone(), medium[idx].0.clone()));
    }

    Some(links)
}

fn tracks_match(
    local: &[(String, String, Option<i32>)],
    medium: &[(String, String, Option<i32>)],
) -> bool {
    pair_tracks(local, medium).is_some()
}

/// Decide whether `siblings` are discs of `candidate`, and how. `None` when any sibling matches zero
/// or more than one medium (ambiguous), when two siblings claim the same medium, or when fewer than
/// two siblings are given (nothing to fold). A candidate medium with no matching sibling is fine - a
/// partially-ripped box is allowed, only every *sibling that exists* must resolve unambiguously.
pub fn plan_box_bind(siblings: &[BoxSibling], candidate: &BoxCandidate) -> Option<BoxBindPlan> {
    if siblings.len() < 2 {
        return None;
    }

    let mut claimed: HashSet<i32> = HashSet::new();
    let mut members: Vec<(String, i32)> = Vec::with_capacity(siblings.len());
    let mut track_links: Vec<(String, String)> = Vec::new();

    for s in siblings {
        let hits: Vec<(&BoxMedium, Vec<(String, String)>)> = candidate
            .media
            .iter()
            .filter_map(|m| pair_tracks(&s.tracks, &m.tracks).map(|links| (m, links)))
            .collect();
        let [(medium, links)] = &hits[..] else {
            return None; // zero or ambiguous
        };
        if !claimed.insert(medium.position) {
            return None; // two siblings claim the same medium
        }
        members.push((s.local_id.clone(), medium.position));
        // The pairing computed by `pair_tracks`, not a positional zip - on a disc whose sequencing
        // differs from MusicBrainz's, zipping linked every track to the wrong recording.
        track_links.extend(links.iter().cloned());
    }

    let mut ordered = members.clone();
    ordered.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    let survivor = ordered[0].0.clone();
    let absorbed: Vec<String> = ordered.into_iter().skip(1).map(|(id, _)| id).collect();

    let folder_path = siblings
        .iter()
        .map(|s| s.folder_path.clone())
        .reduce(|acc, f| common_ancestor(&acc, &f))
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| siblings[0].folder_path.clone());

    Some(BoxBindPlan {
        release_id: candidate.release_id.clone(),
        folder_path,
        survivor,
        absorbed,
        members,
        track_links,
    })
}

// ---------------------------------------------------------------------------
// Candidate discovery - network + DB
// ---------------------------------------------------------------------------

struct FetchedCandidate {
    candidate: BoxCandidate,
    release: MbRelease,
    rg_id: String,
    primary_type: Option<String>,
}

fn build_candidate(release_id: &str, media: &Option<Vec<MbMedia>>) -> Option<BoxCandidate> {
    let discs = common::mb::api::audio_media(media);
    if discs.len() < 2 {
        return None;
    }
    let media_rows: Vec<BoxMedium> = discs
        .into_iter()
        .filter_map(|m| {
            Some(BoxMedium {
                position: m.position? as i32,
                tracks: m
                    .tracks
                    .as_ref()?
                    .iter()
                    .map(|t| (t.id.clone(), t.title.clone(), t.length.map(|l| (l / 1000) as i32)))
                    .collect(),
            })
        })
        .collect();
    if media_rows.len() < 2 {
        return None;
    }
    Some(BoxCandidate {
        release_id: release_id.to_string(),
        media: media_rows,
    })
}

/// Tier (a): the siblings' own majority embedded MB release ids, looked up directly. Catches a box
/// where at least one disc's tag happens to point at the box release itself.
async fn candidates_from_embedded_ids(
    http_client: &Client,
    limiter: &mut RateLimiter,
    ids: &[String],
    reporter: &Reporter,
) -> Vec<FetchedCandidate> {
    let mut out = Vec::new();
    for id in ids {
        reporter.sub_step(&format!("tier (a): looking up embedded id {id}..."));
        match mb_api::mb_get_release_by_id(http_client, id, limiter).await {
            Ok(by_id) => match build_candidate(&by_id.release.id, &by_id.release.media) {
                Some(candidate) => {
                    reporter.sub_step(&format!(
                        "  -> \"{}\", {} disc(s)",
                        by_id.release.title,
                        candidate.media.len()
                    ));
                    out.push(FetchedCandidate {
                        candidate,
                        release: by_id.release,
                        rg_id: by_id.rg_id,
                        primary_type: by_id.primary_type,
                    });
                }
                None => reporter.sub_step(&format!(
                    "  -> \"{}\" has only 1 medium, not a box",
                    by_id.release.title
                )),
            },
            Err(e) => reporter.sub_step(&format!("  -> lookup failed: {e}")),
        }
    }
    out
}

/// Tier (b): search MusicBrainz for the parent folder's own title. Catches a box where no sibling's
/// tag points anywhere near it (every disc is tagged as its own standalone album).
async fn candidates_from_search(
    http_client: &Client,
    limiter: &mut RateLimiter,
    title: &str,
    artist_name: &str,
    reporter: &Reporter,
) -> Vec<FetchedCandidate> {
    reporter.sub_step(&format!(
        "tier (b): searching MusicBrainz for \"{title}\" by {artist_name}..."
    ));
    let hits = match mb_api::mb_search_release_groups(http_client, title, artist_name, limiter).await {
        Ok(hits) => hits,
        Err(e) => {
            reporter.sub_step(&format!("  -> search failed: {e}"));
            return Vec::new();
        }
    };
    reporter.sub_step(&format!("  -> {} release group(s) found", hits.len()));
    let mut out = Vec::new();
    for rg in hits {
        if !common::mb::allowlist::is_allowed(rg.primary_type.as_deref(), &rg.secondary_types, None) {
            reporter.sub_step(&format!(
                "  -> \"{}\" rejected by the allow-list ({:?}, {:?})",
                rg.title, rg.primary_type, rg.secondary_types
            ));
            continue;
        }
        match mb_api::mb_get_release_tracks(http_client, &rg.id, limiter).await {
            Ok(editions) => {
                reporter.sub_step(&format!(
                    "  -> \"{}\": {} edition(s) to check",
                    rg.title,
                    editions.len()
                ));
                for (release, _flattened) in editions {
                    match build_candidate(&release.id, &release.media) {
                        Some(candidate) => {
                            reporter.sub_step(&format!(
                                "     \"{}\" ({}), {} disc(s)",
                                release.title,
                                release.id,
                                candidate.media.len()
                            ));
                            out.push(FetchedCandidate {
                                candidate,
                                release,
                                rg_id: rg.id.clone(),
                                primary_type: rg.primary_type.clone(),
                            });
                        }
                        None => reporter.sub_step(&format!(
                            "     \"{}\" has only 1 medium, not a box",
                            release.title
                        )),
                    }
                }
            }
            Err(e) => reporter.sub_step(&format!("  -> \"{}\" fetch failed: {e}", rg.title)),
        }
    }
    out
}

/// Why a candidate that reached `plan_box_bind` did not produce a bind - diagnostic only, computed
/// separately from the pure decision fn so `plan_box_bind` itself stays a plain `Option` with no
/// reporting concerns. Checked in the same order `plan_box_bind` evaluates siblings.
fn describe_rejection(siblings: &[BoxSibling], candidate: &FetchedCandidate) -> String {
    let mut claimed: HashMap<i32, &str> = HashMap::new();
    for s in siblings {
        let hits: Vec<i32> = candidate
            .candidate
            .media
            .iter()
            .filter(|m| tracks_match(&s.tracks, &m.tracks))
            .map(|m| m.position)
            .collect();
        match hits.len() {
            0 => return format!("[{}] matches no disc of \"{}\"", s.folder_path, candidate.release.title),
            1 => {
                let pos = hits[0];
                if let Some(other) = claimed.insert(pos, &s.folder_path) {
                    return format!(
                        "[{}] and [{}] both match disc {} of \"{}\"",
                        other, s.folder_path, pos, candidate.release.title
                    );
                }
            }
            n => {
                return format!(
                    "[{}] matches {} discs of \"{}\" - ambiguous",
                    s.folder_path, n, candidate.release.title
                )
            }
        }
    }
    "no reason found (this should not happen)".to_string()
}

/// Best-effort box title from a parent folder name: strip a leading "YYYY - " and any trailing
/// "(...)" annotation ("(9CD)", "(Deluxe Edition, 2014, 3 CD)"). MB search tolerates the rest, and
/// the real gate is the track-level perfect match in `plan_box_bind`, not this string.
fn guess_box_title(parent_folder: &str) -> String {
    let last = parent_folder.rsplit('/').next().unwrap_or(parent_folder);
    let without_year = if last.len() > 4 && last.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        last[4..].trim_start_matches([' ', '-']).trim_start()
    } else {
        last
    };
    match without_year.find('(') {
        Some(idx) => without_year[..idx].trim().to_string(),
        None => without_year.trim().to_string(),
    }
}

// ---------------------------------------------------------------------------
// Group discovery - DB only
// ---------------------------------------------------------------------------

struct SiblingRow {
    local_id: String,
    folder_path: String,
    majority_mb_release_id: Option<String>,
}

struct SiblingGroup {
    parent: String,
    rows: Vec<SiblingRow>,
    /// Every artist credited on any folder in this group, for `--only` scoping. Resolved from
    /// `LocalReleaseArtist`, never from the folder path - see `group_matches_filter`.
    artist_names: Vec<String>,
}

/// Folders sharing a parent, at least two of them, none yet folded into one `LocalRelease` - the
/// same directory shape `multi_disc` looks at, but grouped by path rather than a shared embedded id,
/// since a box's siblings frequently carry entirely different (and individually correct-looking)
/// embedded release ids (shape (b), see module docs).
async fn find_sibling_groups(pool: &PgPool) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    // `artist_names` comes along for `--only` scoping (see `group_matches_filter`) - one aggregate in
    // the same query rather than a per-group round trip.
    let rows: Vec<(String, String, String, Option<String>, Vec<String>)> = sqlx::query_as(
        r#"
        WITH f AS (
          SELECT lr.id, lr."folderPath" AS folder_path,
                 regexp_replace(lr."folderPath", '/[^/]+$', '') AS parent,
                 (SELECT t."mbReleaseId" FROM "LocalReleaseTrack" t
                    WHERE t."localReleaseId" = lr.id AND t."mbReleaseId" IS NOT NULL
                    GROUP BY t."mbReleaseId" ORDER BY count(*) DESC, t."mbReleaseId" ASC LIMIT 1) AS majority_mb
          FROM "LocalRelease" lr
          WHERE lr."folderPath" IS NOT NULL
            AND array_length(string_to_array(lr."folderPath", '/'), 1) >= 4
        )
        SELECT f.id, f.folder_path, f.parent, f.majority_mb,
               COALESCE((
                 SELECT array_agg(DISTINCT a.name)
                 FROM "LocalReleaseArtist" lra
                 JOIN "Artist" a ON a.id = lra."artistId"
                 WHERE lra."localReleaseId" = f.id
               ), ARRAY[]::text[]) AS artist_names
        FROM f
        WHERE f.parent IN (SELECT parent FROM f GROUP BY parent HAVING count(*) > 1)
        ORDER BY f.parent, f.folder_path
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut groups: Vec<SiblingGroup> = Vec::new();
    for (id, folder_path, parent, majority_mb, artist_names) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            majority_mb_release_id: majority_mb,
        };
        match groups.last_mut() {
            Some(g) if g.parent == parent => {
                g.rows.push(row);
                for n in artist_names {
                    if !g.artist_names.contains(&n) {
                        g.artist_names.push(n);
                    }
                }
            }
            _ => groups.push(SiblingGroup {
                parent,
                rows: vec![row],
                artist_names,
            }),
        }
    }
    Ok(groups)
}

async fn sibling_tracks(
    pool: &PgPool,
    local_id: &str,
) -> Result<Vec<(String, String, Option<i32>)>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<i32>)> = sqlx::query_as(
        r#"SELECT id, title, duration FROM "LocalReleaseTrack"
           WHERE "localReleaseId" = $1
           ORDER BY "trackNumber" ASC NULLS LAST, id ASC"#,
    )
    .bind(local_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, dur)| (id, title.unwrap_or_default(), dur))
        .collect())
}

/// Does this group fall inside a `--only` scope?
///
/// Matches against the artists actually credited on the group's folders, **not** against
/// `group.parent`. The old code filtered on the parent path, which broke twice over:
///
///   * `--exact` matched nothing at all. `matches_filter` normalizes by stripping non-alphanumerics,
///     so `ABBA/Compilation/2005 - The Complete Studio Recordings (9CD)` becomes
///     `abbacompilation2005 the complete studio recordings 9cd`, which can never equal `abba`. Every
///     `./sync --only X --exact` therefore skipped box-set repair silently, reporting "0 sibling-folder
///     group(s)" as though the artist simply had none.
///   * It read an artist off a directory name, which this codebase does not do (CLAUDE.md: metadata is
///     the source of truth, never filesystem paths). A box filed under a collaborator's folder -
///     `Joan Baez/Compilation/2013 - Voices Of A Generation (2CD)`, credited to Bob Dylan - was
///     excluded from `--only "Bob Dylan"` for no reason but its path.
fn group_matches_filter(group: &SiblingGroup, only: &str, exact: bool) -> bool {
    group
        .artist_names
        .iter()
        .any(|name| common::filters::matches_filter(name, "", "", only, exact))
}

async fn artist_for_group(pool: &PgPool, local_ids: &[String]) -> Option<(String, String)> {
    sqlx::query_as(
        r#"SELECT a.id, a.name FROM "Artist" a
           JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
           WHERE lra."localReleaseId" = ANY($1)
           LIMIT 1"#,
    )
    .bind(local_ids)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

// ---------------------------------------------------------------------------
// Apply - persist a successful plan
// ---------------------------------------------------------------------------

/// Persist the box's own `MusicBrainzRelease` + media + tracks. Pure MB-side work, no `LocalRelease`
/// mutation - the caller decides fold vs dissolve afterward (docs/multidisk.md §5 point 4), once
/// `box_editions::run_link_box_editions` has had a chance to derive equivalences, which needs these
/// media rows to exist first. Returns the box's `MusicBrainzRelease.id`.
async fn persist_box_media(
    pool: &PgPool,
    fetched: &FetchedCandidate,
    plan: &BoxBindPlan,
    release_type_cache: &mut HashMap<String, String>,
    artist_id: &str,
    artist_genre_ids: &[String],
) -> Result<String, sqlx::Error> {
    let type_name = fetched.primary_type.as_deref().unwrap_or("Other");
    let type_id = ensure_release_type_cached(pool, type_name, release_type_cache).await?;
    let year = fetched
        .release
        .date
        .as_deref()
        .and_then(|d| d.split('-').next())
        .and_then(|y| y.parse::<i32>().ok());
    let format_str = crate::format_from_media(&fetched.release.media);
    let extras = MbReleaseExtras {
        release_date: fetched.release.date.as_deref(),
        packaging: fetched.release.packaging.as_deref(),
        country: fetched.release.country.as_deref(),
        format: format_str.as_deref(),
        ..Default::default()
    };
    // Box-level status only, at this stage: whether every medium is owned by some sibling. Per-disc
    // status (COMPLETE/MISSING_TRACKS scored against the right target, fold or dissolved) is left
    // UNKNOWN by apply_fold/apply_dissolve below and picked up by the ordinary bind path's
    // medium-scoped check_release_status on this artist's next sync pass - the same "next sync
    // re-scores it" convention the old tier-1 fold already relied on.
    let complete = plan.members.len() == fetched.candidate.media.len();
    let status = if complete { "COMPLETE" } else { "MISSING_TRACKS" };
    let reason = (!complete)
        .then(|| format!("{} of {} discs present", plan.members.len(), fetched.candidate.media.len()));

    let mb_db_id = upsert_mb_release_with_media(
        pool,
        &plan.release_id,
        &fetched.rg_id,
        &fetched.release.title,
        year,
        &type_id,
        status,
        reason.as_deref(),
        fetched.release.disambiguation.as_deref(),
        &extras,
        fetched.candidate.media.len() as i32,
    )
    .await?;
    sync_mb_media_for_release(pool, &mb_db_id, &mb_medium_rows(&fetched.release.media)).await?;
    ensure_mb_release_artist_link(pool, &mb_db_id, artist_id).await.ok();
    batch_link_release_genres(pool, &mb_db_id, artist_genre_ids).await.ok();

    let flattened = common::mb::api::flatten_audio_tracks(&fetched.release.media);
    let track_rows: Vec<MbTrackRow> = flattened
        .iter()
        .map(|t| MbTrackRow {
            title: t.title.clone(),
            position: t.position.map(|p| p as i32),
            disc_number: t.disc_number.map(|d| d as i32),
            duration_ms: t.length.map(|l| l as i32),
            mb_id: Some(t.id.clone()),
            recording_id: t.recording.as_ref().map(|r| r.id.clone()),
        })
        .collect();
    let inserted = sync_mb_tracks_for_release(pool, &mb_db_id, &track_rows).await?;

    // Link each sibling's local tracks to the box's own MB track rows. Kept the same for both fold
    // and dissolve outcomes as a deliberate simplification: after a dissolve the tracks conceptually
    // belong to the equivalent target release, but re-matching them against the target's own track
    // rows is a second matching pass this rollout doesn't do - the linked recording is identical
    // either way (that's what the equivalence match already proved), just catalogued under the box's
    // release-scoped track id rather than the target's.
    let track_links: Vec<(String, String)> = plan
        .track_links
        .iter()
        .filter_map(|(local_id, mb_raw)| {
            inserted
                .iter()
                .find(|(_, mid)| mid.as_deref() == Some(mb_raw.as_str()))
                .map(|(db_id, _)| (local_id.clone(), db_id.clone()))
        })
        .collect();
    link_local_tracks_to_mb(pool, &track_links).await.ok();

    Ok(mb_db_id)
}

// ---------------------------------------------------------------------------
// Fold vs dissolve (docs/multidisk.md §3, §5 point 4)
// ---------------------------------------------------------------------------

enum BoxOutcome {
    Fold,
    Dissolve,
}

/// Flat `>= 2` threshold, no "majority" clause, at every box size - a 9-medium box with only 2
/// confirmed equivalents still dissolves; its other 7 discs correctly render as their own box-disc
/// rows rather than hiding 2 known editions inside one folded card.
fn decide_outcome(equivalent_count: usize) -> BoxOutcome {
    if equivalent_count >= 2 {
        BoxOutcome::Dissolve
    } else {
        BoxOutcome::Fold
    }
}

async fn count_equivalents(pool: &PgPool, mb_db_id: &str) -> Result<usize, sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT count(*) FROM "MusicBrainzReleaseMedium"
           WHERE "releaseId" = $1 AND "equivalentReleaseId" IS NOT NULL"#,
    )
    .bind(mb_db_id)
    .fetch_one(pool)
    .await?;
    Ok(count.max(0) as usize)
}

/// Genuine multi-disc release (0 or 1 equivalent medium): merge every sibling into one `LocalRelease`,
/// bound to the box itself. Folder-derived `groupKey` (`"folder:{ancestor}"`, never
/// `"mbrelease:{id}"` - the latter collides when two local copies of one box both plan the same key,
/// which is exactly what `./audit --duplicate-release` needs to be able to tell apart).
async fn apply_fold(pool: &PgPool, plan: &BoxBindPlan, mb_db_id: &str) -> Result<(), sqlx::Error> {
    let local_ids: Vec<String> = plan.members.iter().map(|(id, _)| id.clone()).collect();
    let folder_rows: Vec<(String, Option<String>)> =
        sqlx::query_as(r#"SELECT id, "folderPath" FROM "LocalRelease" WHERE id = ANY($1)"#)
            .bind(&local_ids)
            .fetch_all(pool)
            .await?;
    let folder_by_id: HashMap<String, String> = folder_rows
        .into_iter()
        .map(|(id, fp)| (id, fp.unwrap_or_default()))
        .collect();

    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;

    // Stamp discNumber from the medium position BEFORE tracks move onto the survivor - once merged,
    // "which sibling did this track come from" is no longer recoverable from localReleaseId alone.
    for (local_id, position) in &plan.members {
        sqlx::query(
            r#"UPDATE "LocalReleaseTrack" SET "discNumber" = $1, "updatedAt" = $2 WHERE "localReleaseId" = $3"#,
        )
        .bind(position)
        .bind(now)
        .bind(local_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET "localReleaseId" = $1, "updatedAt" = $2 WHERE "localReleaseId" = ANY($3)"#,
    )
    .bind(&plan.survivor)
    .bind(now)
    .bind(&plan.absorbed)
    .execute(&mut *tx)
    .await?;
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1)"#)
        .bind(&plan.absorbed)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"UPDATE "LocalRelease"
           SET "groupKey" = $1, "folderPath" = $2, "releaseId" = $3, "mediumPosition" = NULL,
               "boxReleaseId" = NULL, "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN',
               "updatedAt" = $4
           WHERE id = $5"#,
    )
    .bind(format!("folder:{}", plan.folder_path))
    .bind(&plan.folder_path)
    .bind(mb_db_id)
    .bind(now)
    .bind(&plan.survivor)
    .execute(&mut *tx)
    .await?;

    // One LocalReleaseMember per sibling (survivor included) so a plain re-index recognises every
    // folder next time instead of re-splitting a box whose discs all tag discNumber=1 (shape (b)).
    for (local_id, position) in &plan.members {
        let folder = folder_by_id.get(local_id.as_str()).map(String::as_str).unwrap_or_default();
        let member_id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseMember" (id, "localReleaseId", "folderPath", "discNumber")
               VALUES ($1, $2, $3, $4)
               ON CONFLICT ("folderPath") DO UPDATE SET
                 "localReleaseId" = EXCLUDED."localReleaseId", "discNumber" = EXCLUDED."discNumber""#,
        )
        .bind(&member_id)
        .bind(&plan.survivor)
        .bind(folder)
        .bind(position)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await
}

/// Box set (>=2 equivalent media): leave every sibling as its own `LocalRelease` row. Each disc binds
/// individually - to the standalone album it reprints (provenance recorded via `boxReleaseId`/
/// `boxMediumPosition`), or to the box itself when it has no equivalent (a rarities/bonus disc, or one
/// below tier 3's title/track-count gates). No `LocalReleaseMember` rows - dissolve never folds.
async fn apply_dissolve(pool: &PgPool, plan: &BoxBindPlan, mb_db_id: &str) -> Result<(), sqlx::Error> {
    let now = Utc::now().naive_utc();
    for (local_id, position) in &plan.members {
        let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
            r#"SELECT "equivalentReleaseId", "equivalentMediumPosition" FROM "MusicBrainzReleaseMedium"
               WHERE "releaseId" = $1 AND "position" = $2"#,
        )
        .bind(mb_db_id)
        .bind(position)
        .fetch_optional(pool)
        .await?;
        let equivalent: Option<(String, Option<i32>)> =
            row.and_then(|(release_id, medium_position)| release_id.map(|r| (r, medium_position)));

        // `matchStatus = 'UNKNOWN'` means "score this again", so it must only be written when the
        // binding actually moves. This pass runs at the tail of *every* sync and re-derives the same
        // plan for a box that is already dissolved, so writing it unconditionally left those discs
        // permanently unscored: the release loop scored them, the tail reset them, and the next run
        // repeated it. ABBA's nine-disc box sat at UNKNOWN through three consecutive syncs that way.
        // The `WHERE` clauses below make each write a no-op once the row already says this.
        match equivalent {
            Some((equivalent_release_id, equivalent_medium_position)) => {
                sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = $3,
                           "boxMediumPosition" = $4, "matchStatus" = 'UNKNOWN', "updatedAt" = $5
                       WHERE id = $6
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS DISTINCT FROM $3
                           OR "boxMediumPosition" IS DISTINCT FROM $4)"#,
                )
                .bind(&equivalent_release_id)
                .bind(equivalent_medium_position)
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(pool)
                .await?;
            }
            None => {
                sqlx::query(
                    r#"UPDATE "LocalRelease"
                       SET "releaseId" = $1, "mediumPosition" = $2, "boxReleaseId" = NULL,
                           "boxMediumPosition" = NULL, "matchStatus" = 'UNKNOWN', "updatedAt" = $3
                       WHERE id = $4
                         AND ("releaseId" IS DISTINCT FROM $1
                           OR "mediumPosition" IS DISTINCT FROM $2
                           OR "boxReleaseId" IS NOT NULL
                           OR "boxMediumPosition" IS NOT NULL)"#,
                )
                .bind(mb_db_id)
                .bind(position)
                .bind(now)
                .bind(local_id)
                .execute(pool)
                .await?;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct BoxSetSummary {
    pub groups_seen: usize,
    pub groups_bound: usize,
    pub rows_absorbed: usize,
    pub groups_folded: usize,
    pub groups_dissolved: usize,
}

#[allow(clippy::too_many_arguments)]
/// Two phases, in order:
///
///   1. Bind every matched sibling group's box to its own `MusicBrainzRelease` + media + tracks
///      (`persist_box_media`) - no `LocalRelease` writes yet, that decision needs equivalences.
///   2. Once every box in this run has its media persisted, derive equivalences once
///      (`box_editions::run_link_box_editions`, whole-catalogue but cheap - pure SQL for tier 1,
///      artist-scoped for tiers 2/3) and only then decide fold vs dissolve per box and write it
///      (docs/multidisk.md §5 point 4).
///
/// No dry-run (docs/multidisk.md §11/§12 - the user's `./backup` is the recovery path). `only`/
/// `exact` scope which sibling groups are considered, matching every other sync mode's convention -
/// called once per sync invocation with that invocation's own scope, not once per artist inside a
/// loop (this pass' own group-discovery query is a whole-table scan; looping it per-artist would
/// repeat that scan for every artist synced).
pub async fn run_repair(
    pool: &PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &Reporter,
    only: &str,
    exact: bool,
) -> Result<BoxSetSummary, sqlx::Error> {
    let mut groups = find_sibling_groups(pool).await?;
    if !only.is_empty() {
        groups.retain(|g| group_matches_filter(g, only, exact));
    }
    let mut summary = BoxSetSummary {
        groups_seen: groups.len(),
        ..Default::default()
    };
    reporter.info(&format!(
        "{} sibling-folder group(s) not folded by tier 1",
        summary.groups_seen
    ));
    reporter.blank();

    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let total = groups.len();
    let mut bound: Vec<(BoxBindPlan, String)> = Vec::new();

    for (idx, group) in groups.into_iter().enumerate() {
        if group.rows.len() < 2 {
            continue;
        }
        reporter.item("Group", &group.parent, idx + 1, total);
        reporter.sub_step(&format!("{} sibling folder(s):", group.rows.len()));
        for r in &group.rows {
            reporter.sub_step(&format!(
                "  [{}] embedded id: {}",
                r.folder_path,
                r.majority_mb_release_id.as_deref().unwrap_or("(none)")
            ));
        }

        let mut siblings: Vec<BoxSibling> = Vec::with_capacity(group.rows.len());
        for row in &group.rows {
            let tracks = sibling_tracks(pool, &row.local_id).await?;
            siblings.push(BoxSibling {
                local_id: row.local_id.clone(),
                folder_path: row.folder_path.clone(),
                tracks,
            });
        }

        let local_ids: Vec<String> = group.rows.iter().map(|r| r.local_id.clone()).collect();
        let Some((artist_id, artist_name)) = artist_for_group(pool, &local_ids).await else {
            reporter.skip("no artist link found for this group - skipped");
            continue;
        };

        let embedded_ids: Vec<String> = group
            .rows
            .iter()
            .filter_map(|r| r.majority_mb_release_id.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();

        let mut fetched =
            candidates_from_embedded_ids(http_client, limiter, &embedded_ids, reporter).await;
        if fetched.is_empty() {
            let title = guess_box_title(&group.parent);
            fetched =
                candidates_from_search(http_client, limiter, &title, &artist_name, reporter).await;
        }

        if fetched.is_empty() {
            reporter.skip("no multi-medium candidate found");
            continue;
        }

        let plan = fetched
            .iter()
            .find_map(|f| plan_box_bind(&siblings, &f.candidate).map(|p| (f, p)));

        let Some((fetched, plan)) = plan else {
            let reasons: Vec<String> = fetched.iter().map(|f| describe_rejection(&siblings, f)).collect();
            reporter.skip(&format!(
                "{} candidate(s) checked, none matched: {}",
                reasons.len(),
                reasons.join("; ")
            ));
            continue;
        };

        println!(
            "{} {} -> {} ({} sibling(s) matched, {}/{} discs owned)",
            "▸".cyan(),
            plan.release_id,
            plan.folder_path,
            plan.members.len(),
            plan.members.len(),
            fetched.candidate.media.len(),
        );
        for s in &siblings {
            let owned = plan.members.iter().any(|(id, _)| id == &s.local_id);
            let mark = if owned { "OWN  ".green().bold() } else { "skip ".yellow() };
            println!("    {} {} [{}]", mark, s.local_id, s.folder_path);
        }

        summary.groups_bound += 1;
        summary.rows_absorbed += plan.absorbed.len();

        let artist_genre_ids = get_artist_genre_ids(pool, &artist_id).await;
        let mb_db_id =
            persist_box_media(pool, fetched, &plan, &mut release_type_cache, &artist_id, &artist_genre_ids)
                .await?;
        bound.push((plan, mb_db_id));
    }

    if bound.is_empty() {
        return Ok(summary);
    }

    reporter.blank();
    reporter.header("Deriving box-set equivalences");
    box_editions::run_link_box_editions(pool, reporter).await?;

    reporter.blank();
    reporter.header("Fold vs dissolve");
    for (plan, mb_db_id) in &bound {
        let equivalents = count_equivalents(pool, mb_db_id).await?;
        match decide_outcome(equivalents) {
            BoxOutcome::Fold => {
                apply_fold(pool, plan, mb_db_id).await?;
                summary.groups_folded += 1;
                println!(
                    "{} {} -> fold ({} equivalent medium/media)",
                    "▸".cyan(),
                    plan.folder_path,
                    equivalents
                );
            }
            BoxOutcome::Dissolve => {
                apply_dissolve(pool, plan, mb_db_id).await?;
                summary.groups_dissolved += 1;
                println!(
                    "{} {} -> dissolve ({} equivalent medium/media)",
                    "▸".cyan(),
                    plan.folder_path,
                    equivalents
                );
            }
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group_with_artists(parent: &str, artists: &[&str]) -> SiblingGroup {
        SiblingGroup {
            parent: parent.to_string(),
            rows: Vec::new(),
            artist_names: artists.iter().map(|a| a.to_string()).collect(),
        }
    }

    /// The regression: scoping used to compare `--only` against the *parent path*, which
    /// `matches_filter` normalizes to `abbacompilation2005 the complete...`. Under `--exact` that can
    /// never equal `abba`, so every `--only X --exact` sync skipped box-set repair while reporting
    /// "0 sibling-folder group(s)" - indistinguishable from the artist genuinely having none.
    /// The regression that left ABBA's "The Complete Studio Recordings (9CD)" unbound: a perfect
    /// 9-of-9 rip whose disc 1 holds exactly MusicBrainz's 19 tracks in a different sequence. Matching
    /// by position rejected that disc, and one rejected sibling rejects the whole group.
    #[test]
    fn a_disc_sequenced_differently_still_matches_the_same_medium() {
        let local = sibling(
            "cd1",
            "Box/CD 1",
            &[
                ("l1", "Ring Ring", Some(184)),
                ("l2", "Åh, vilka tider", Some(153)),
                ("l3", "Rock'n Roll Band", Some(190)),
            ],
        );
        let m = medium(
            1,
            &[
                ("m1", "Ring Ring", Some(186)),
                ("m2", "Rock ’n Roll Band", Some(194)),
                ("m3", "Åh, vilka tider", Some(153)),
            ],
        );
        let links = pair_tracks(&local.tracks, &m.tracks).expect("same set, different order");
        // Each local track links to its own recording, not to whatever sat at the same index.
        assert_eq!(
            links,
            vec![
                ("l1".to_string(), "m1".to_string()),
                ("l2".to_string(), "m3".to_string()),
                ("l3".to_string(), "m2".to_string()),
            ]
        );
    }

    /// ABBA's "The Complete Studio Recordings" disc 1: a perfect 19-of-19 rip whose opener is tagged
    /// with a qualifier MusicBrainz leaves off. One word rejected the whole nine-disc box.
    #[test]
    fn a_qualified_title_pairs_with_the_plain_one() {
        let local = sibling("cd1", "Box/CD 1", &[
            ("l1", "Ring Ring (English version)", Some(184)),
            ("l2", "Another Town, Another Train", Some(193)),
            ("l3", "Nina, Pretty Ballerina", Some(174)),
        ]);
        let m = medium(1, &[
            ("m1", "Ring Ring", Some(186)),
            ("m2", "Another Town, Another Train", Some(193)),
            ("m3", "Nina, Pretty Ballerina", Some(173)),
        ]);
        let links = pair_tracks(&local.tracks, &m.tracks).expect("qualifier must not block the pairing");
        // Keyed, not indexed: exact matches are claimed first, so the loose pair lands last.
        let by_local: std::collections::HashMap<_, _> = links.into_iter().collect();
        assert_eq!(by_local["l1"], "m1");
        assert_eq!(by_local["l2"], "m2");
        assert_eq!(by_local["l3"], "m3");
    }

    /// The hazard the two passes exist to avoid. That same disc carries four language versions of
    /// "Ring Ring" whose durations all sit within tolerance of the plain one, so a greedy
    /// substring-first scan would pair whichever happened to come first. Exact titles must be claimed
    /// before any loose match is considered.
    #[test]
    fn an_exact_title_is_claimed_before_a_loose_one_competes_for_it() {
        let local = sibling("cd1", "Box/CD 1", &[
            ("l1", "Ring Ring (Spanish version)", Some(182)),
            ("l2", "Ring Ring (English version)", Some(184)),
            ("l3", "Santa Rosa", Some(181)),
        ]);
        let m = medium(1, &[
            ("m1", "Ring Ring", Some(186)),
            ("m2", "Ring Ring (Spanish version)", Some(181)),
            ("m3", "Santa Rosa", Some(181)),
        ]);
        let links = pair_tracks(&local.tracks, &m.tracks).expect("should pair");
        let by_local: std::collections::HashMap<_, _> = links.into_iter().collect();
        assert_eq!(by_local["l1"], "m2", "the Spanish tag must take the Spanish track");
        assert_eq!(by_local["l2"], "m1", "the English tag takes the plain one that is left");
    }

    /// ABBA's disc 5: eleven titles line up exactly, one runtime is six seconds out, and that used to
    /// reject the entire nine-disc box.
    #[test]
    fn a_few_seconds_of_master_drift_does_not_reject_a_disc() {
        let local = sibling("cd5", "Box/CD 5", &[
            ("l1", "Eagle", Some(349)),
            ("l2", "I'm a Marionette", Some(243)),
            ("l3", "Thank You for the Music", Some(229)),
        ]);
        let m = medium(5, &[
            ("m1", "Eagle", Some(349)),
            ("m2", "I’m a Marionette", Some(249)),
            ("m3", "Thank You for the Music", Some(229)),
        ]);
        let by_local: std::collections::HashMap<_, _> =
            pair_tracks(&local.tracks, &m.tracks).expect("six seconds is drift, not a different track")
                .into_iter().collect();
        assert_eq!(by_local["l2"], "m2");
    }

    /// The bound still has to mean something: a shared title with a wildly different runtime is a
    /// different recording, not a different rip.
    #[test]
    fn a_wildly_different_runtime_is_still_a_different_track() {
        let local = sibling("a", "f", &[("l1", "One", Some(100)), ("l2", "Jam", Some(120))]);
        let m = medium(1, &[("m1", "One", Some(100)), ("m2", "Jam", Some(600))]);
        assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
    }

    /// A loose match that fits two remaining tracks equally is refused, not guessed at.
    #[test]
    fn an_ambiguous_loose_match_is_refused() {
        let local = sibling("cd1", "Box/CD 1", &[
            ("l1", "Ring Ring", Some(185)),
            ("l2", "Filler", Some(100)),
        ]);
        let m = medium(1, &[
            ("m1", "Ring Ring (English version)", Some(184)),
            ("m2", "Ring Ring (Spanish version)", Some(186)),
        ]);
        assert!(pair_tracks(&local.tracks, &m.tracks).is_none());
    }

    #[test]
    fn a_differing_tracklist_still_fails_to_pair() {
        let local = sibling("a", "f", &[("l1", "One", Some(100)), ("l2", "Two", Some(100))]);
        let wrong_title = medium(1, &[("m1", "One", Some(100)), ("m2", "Three", Some(100))]);
        let wrong_len = medium(1, &[("m1", "One", Some(100))]);
        let wrong_dur = medium(1, &[("m1", "One", Some(100)), ("m2", "Two", Some(400))]);
        assert!(pair_tracks(&local.tracks, &wrong_title.tracks).is_none());
        assert!(pair_tracks(&local.tracks, &wrong_len.tracks).is_none());
        assert!(pair_tracks(&local.tracks, &wrong_dur.tracks).is_none());
    }

    #[test]
    fn repeated_titles_each_claim_a_distinct_medium_track() {
        let local = sibling("a", "f", &[("l1", "Intro", Some(60)), ("l2", "Intro", Some(60))]);
        let m = medium(1, &[("m1", "Intro", Some(60)), ("m2", "Intro", Some(60))]);
        let links = pair_tracks(&local.tracks, &m.tracks).unwrap();
        assert_eq!(links.len(), 2);
        assert_ne!(links[0].1, links[1].1, "one medium track cannot serve two local tracks");
    }

    #[test]
    fn exact_scoping_matches_the_artist_not_the_folder_path() {
        let g = group_with_artists(
            "ABBA/Compilation/2005 - The Complete Studio Recordings (9CD)",
            &["ABBA"],
        );
        assert!(group_matches_filter(&g, "ABBA", true), "--exact must find this box");
        assert!(group_matches_filter(&g, "ABBA", false), "prefix mode still works");
        assert!(!group_matches_filter(&g, "Blondie", true));
    }

    /// A box filed under a collaborator's folder still belongs to the artist credited on it. Path
    /// scoping excluded these for no reason but their directory name.
    #[test]
    fn a_group_is_scoped_by_every_artist_credited_on_it() {
        let g = group_with_artists(
            "Joan Baez/Compilation/2013 - Voices Of A Generation (2CD)",
            &["Joan Baez", "Bob Dylan"],
        );
        assert!(group_matches_filter(&g, "Bob Dylan", true));
        assert!(group_matches_filter(&g, "Joan Baez", true));
    }

    #[test]
    fn a_group_with_no_credited_artist_matches_no_filter() {
        let g = group_with_artists("Unknown/Album/Box", &[]);
        assert!(!group_matches_filter(&g, "ABBA", false));
    }

    fn sibling(id: &str, folder: &str, tracks: &[(&str, &str, Option<i32>)]) -> BoxSibling {
        BoxSibling {
            local_id: id.to_string(),
            folder_path: folder.to_string(),
            tracks: tracks
                .iter()
                .map(|(tid, title, secs)| (tid.to_string(), title.to_string(), *secs))
                .collect(),
        }
    }

    fn medium(position: i32, tracks: &[(&str, &str, Option<i32>)]) -> BoxMedium {
        BoxMedium {
            position,
            tracks: tracks
                .iter()
                .map(|(tid, title, secs)| (tid.to_string(), title.to_string(), *secs))
                .collect(),
        }
    }

    #[test]
    fn shape_a_binds_a_disc_mis_tagged_as_the_standalone_album() {
        // CD1 is tagged as the standalone "Ring Ring" release, CD2 as the box - tier 1 leaves both
        // behind since they don't share an embedded release id. Tier 2 matches by tracklist alone.
        let siblings = vec![
            sibling(
                "cd1",
                "ABBA/Box/CD 1-1973 - Ring Ring",
                &[("t1", "Ring Ring", Some(186)), ("t2", "Another Town, Another Train", Some(193))],
            ),
            sibling("cd2", "ABBA/Box/CD 2-1974 - Waterloo", &[("t3", "Waterloo", Some(180))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![
                medium(1, &[("mb-t1", "Ring Ring", Some(185)), ("mb-t2", "Another Town, Another Train", Some(192))]),
                medium(2, &[("mb-t3", "Waterloo", Some(179))]),
            ],
        };

        let plan = plan_box_bind(&siblings, &candidate).expect("binds");
        assert_eq!(plan.release_id, "mb-box");
        assert_eq!(plan.survivor, "cd1");
        assert_eq!(plan.absorbed, vec!["cd2".to_string()]);
        assert_eq!(plan.folder_path, "ABBA/Box");
        assert_eq!(plan.members.len(), 2);
        assert_eq!(
            plan.track_links,
            vec![
                ("t1".to_string(), "mb-t1".to_string()),
                ("t2".to_string(), "mb-t2".to_string()),
                ("t3".to_string(), "mb-t3".to_string()),
            ]
        );
    }

    #[test]
    fn shape_b_binds_discs_each_tagged_as_their_own_standalone_album() {
        // Neither sibling's embedded id points at the box at all - every disc was tagged as its own
        // album. Nothing here differs mechanically from shape (a): tier 2 never looks at tags.
        let siblings = vec![
            sibling("ringring", "ABBA/Box/1973 - Ring Ring", &[("t1", "Ring Ring", Some(186))]),
            sibling("waterloo", "ABBA/Box/1974 - Waterloo", &[("t2", "Waterloo", Some(180))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![
                medium(1, &[("mb-t1", "Ring Ring", Some(185))]),
                medium(2, &[("mb-t2", "Waterloo", Some(179))]),
                medium(3, &[("mb-t3", "Bonus Tracks", Some(200))]),
            ],
        };

        let plan = plan_box_bind(&siblings, &candidate).expect("binds");
        assert_eq!(plan.members.len(), 2, "only the two ripped discs, the third is simply not owned");
    }

    #[test]
    fn a_partially_ripped_box_is_allowed() {
        let siblings = vec![
            sibling("cd1", "Box/CD1", &[("t1", "A", Some(100))]),
            sibling("cd3", "Box/CD3", &[("t3", "C", Some(100))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![
                medium(1, &[("mb-t1", "A", Some(100))]),
                medium(2, &[("mb-t2", "B", Some(100))]),
                medium(3, &[("mb-t3", "C", Some(100))]),
            ],
        };

        let plan = plan_box_bind(&siblings, &candidate).expect("binds");
        assert_eq!(plan.members.len(), 2);
    }

    #[test]
    fn refuses_when_two_siblings_claim_the_same_medium() {
        // Duplicate rips of the same disc, not two halves of a box - reject rather than guess which
        // copy is canonical (mirrors multi_disc::plan_group's contested-disc rule).
        let siblings = vec![
            sibling("a", "Box/CD1 [FLAC]", &[("t1", "A", Some(100))]),
            sibling("b", "Box/CD1 [MP3]", &[("t2", "A", Some(100))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![medium(1, &[("mb-t1", "A", Some(100))])],
        };

        assert!(plan_box_bind(&siblings, &candidate).is_none());
    }

    #[test]
    fn refuses_when_a_sibling_matches_no_medium() {
        // Wrong candidate entirely: track counts/titles don't line up with any medium.
        let siblings = vec![
            sibling("a", "Box/CD1", &[("t1", "A", Some(100))]),
            sibling("b", "Box/CD2", &[("t2", "Totally Different", Some(999))]),
        ];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![
                medium(1, &[("mb-t1", "A", Some(100))]),
                medium(2, &[("mb-t2", "B", Some(100))]),
            ],
        };

        assert!(plan_box_bind(&siblings, &candidate).is_none());
    }

    #[test]
    fn a_single_sibling_is_never_a_bind() {
        let siblings = vec![sibling("a", "Box/CD1", &[("t1", "A", Some(100))])];
        let candidate = BoxCandidate {
            release_id: "mb-box".to_string(),
            media: vec![medium(1, &[("mb-t1", "A", Some(100))])],
        };
        assert!(plan_box_bind(&siblings, &candidate).is_none());
    }

    #[test]
    fn guesses_a_search_title_from_the_parent_folder() {
        assert_eq!(guess_box_title("ABBA/Compilation/2008 - The Albums (9CD)"), "The Albums");
        assert_eq!(
            guess_box_title("ABBA/Compilation/2005 - The Complete Studio Recordings (9CD)"),
            "The Complete Studio Recordings"
        );
        assert_eq!(guess_box_title("ABBA/Compilation/No Year Box (3CD)"), "No Year Box");
    }

    // -----------------------------------------------------------------------
    // Fold vs dissolve (docs/multidisk.md §3)
    // -----------------------------------------------------------------------

    #[test]
    fn folds_at_zero_equivalents() {
        assert!(matches!(decide_outcome(0), BoxOutcome::Fold));
    }

    #[test]
    fn folds_at_exactly_one_equivalent() {
        // The E-special-edition case: a lone equivalent medium is deliberately not enough to
        // dissolve a genuine multi-disc release over one coincidental link.
        assert!(matches!(decide_outcome(1), BoxOutcome::Fold));
    }

    #[test]
    fn dissolves_at_two_equivalents() {
        assert!(matches!(decide_outcome(2), BoxOutcome::Dissolve));
    }

    #[test]
    fn dissolves_at_two_equivalents_regardless_of_total_medium_count() {
        // A 9-medium box with only 2 confirmed equivalents still dissolves - folding it would hide
        // 2 known editions to avoid showing 7 unrecognised discs, which is strictly worse.
        assert!(matches!(decide_outcome(2), BoxOutcome::Dissolve));
        assert!(matches!(decide_outcome(9), BoxOutcome::Dissolve));
    }
}
