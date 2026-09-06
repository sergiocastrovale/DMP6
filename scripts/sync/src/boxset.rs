//! Tier-2 box-set binding: folds sibling disc folders that tier 1
//! (`index::db::plan_disc_merges` / `multi_disc::plan_group`) could not merge, because MusicBrainz
//! box sets don't carry the discipline tier 1 relies on - see `docs/box_sets.md` for the full
//! investigation. Two shapes tier 1 misses:
//!
//!   (a) one disc mis-tagged as the standalone album (embedded ids disjoint, not unanimous)
//!   (b) every disc tagged as its own standalone album (embedded ids differ entirely, and often
//!       every sibling reads discNumber=1 since no file was ever told it was part of a box)
//!
//! MusicBrainz has no box-set entity: a box is one Release with N media, and MB stores no link from
//! a box's disc to the standalone release it duplicates - the only shared identity is the recording
//! (docs/box_sets.md §2). This module therefore matches siblings to *media* by tracklist, never by
//! any id the files carry, and accepts only a **perfect matching**: every sibling maps to exactly one
//! medium, with equal track count and every track's title+duration (±5s) agreeing - the same rule
//! `owned::find_owning_bundle` uses for the bonus-disc case. Any ambiguity rejects the whole group;
//! a box with some discs not owned at all is fine (a partial match), a box where a disc could equally
//! be two different media is not.

use std::collections::{HashMap, HashSet};

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

fn tracks_match(
    local: &[(String, String, Option<i32>)],
    medium: &[(String, String, Option<i32>)],
) -> bool {
    if local.len() != medium.len() {
        return false;
    }
    local.iter().zip(medium.iter()).all(|((_, lt, ls), (_, mt, ms))| {
        normalize_title(lt) == normalize_title(mt) && durations_compatible(*ls, *ms)
    })
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
        let hits: Vec<&BoxMedium> = candidate
            .media
            .iter()
            .filter(|m| tracks_match(&s.tracks, &m.tracks))
            .collect();
        let [medium] = hits[..] else {
            return None; // zero or ambiguous
        };
        if !claimed.insert(medium.position) {
            return None; // two siblings claim the same medium
        }
        members.push((s.local_id.clone(), medium.position));
        for ((local_track_id, _, _), (mb_track_id, _, _)) in s.tracks.iter().zip(medium.tracks.iter()) {
            track_links.push((local_track_id.clone(), mb_track_id.clone()));
        }
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
    verbose: bool,
) -> Vec<FetchedCandidate> {
    let mut out = Vec::new();
    for id in ids {
        if verbose {
            reporter.sub_step(&format!("tier (a): looking up embedded id {id}..."));
        }
        match mb_api::mb_get_release_by_id(http_client, id, limiter).await {
            Ok(by_id) => match build_candidate(&by_id.release.id, &by_id.release.media) {
                Some(candidate) => {
                    if verbose {
                        reporter.sub_step(&format!(
                            "  -> \"{}\", {} disc(s)",
                            by_id.release.title,
                            candidate.media.len()
                        ));
                    }
                    out.push(FetchedCandidate {
                        candidate,
                        release: by_id.release,
                        rg_id: by_id.rg_id,
                        primary_type: by_id.primary_type,
                    });
                }
                None if verbose => reporter.sub_step(&format!(
                    "  -> \"{}\" has only 1 medium, not a box",
                    by_id.release.title
                )),
                None => {}
            },
            Err(e) if verbose => reporter.sub_step(&format!("  -> lookup failed: {e}")),
            Err(_) => {}
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
    verbose: bool,
) -> Vec<FetchedCandidate> {
    if verbose {
        reporter.sub_step(&format!(
            "tier (b): searching MusicBrainz for \"{title}\" by {artist_name}..."
        ));
    }
    let hits = match mb_api::mb_search_release_groups(http_client, title, artist_name, limiter).await {
        Ok(hits) => hits,
        Err(e) => {
            if verbose {
                reporter.sub_step(&format!("  -> search failed: {e}"));
            }
            return Vec::new();
        }
    };
    if verbose {
        reporter.sub_step(&format!("  -> {} release group(s) found", hits.len()));
    }
    let mut out = Vec::new();
    for rg in hits {
        if !common::mb::allowlist::is_allowed(rg.primary_type.as_deref(), &rg.secondary_types, None) {
            if verbose {
                reporter.sub_step(&format!(
                    "  -> \"{}\" rejected by the allow-list ({:?}, {:?})",
                    rg.title, rg.primary_type, rg.secondary_types
                ));
            }
            continue;
        }
        match mb_api::mb_get_release_tracks(http_client, &rg.id, limiter).await {
            Ok(editions) => {
                if verbose {
                    reporter.sub_step(&format!(
                        "  -> \"{}\": {} edition(s) to check",
                        rg.title,
                        editions.len()
                    ));
                }
                for (release, _flattened) in editions {
                    match build_candidate(&release.id, &release.media) {
                        Some(candidate) => {
                            if verbose {
                                reporter.sub_step(&format!(
                                    "     \"{}\" ({}), {} disc(s)",
                                    release.title,
                                    release.id,
                                    candidate.media.len()
                                ));
                            }
                            out.push(FetchedCandidate {
                                candidate,
                                release,
                                rg_id: rg.id.clone(),
                                primary_type: rg.primary_type.clone(),
                            });
                        }
                        None if verbose => reporter.sub_step(&format!(
                            "     \"{}\" has only 1 medium, not a box",
                            release.title
                        )),
                        None => {}
                    }
                }
            }
            Err(e) if verbose => reporter.sub_step(&format!("  -> \"{}\" fetch failed: {e}", rg.title)),
            Err(_) => {}
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
}

/// Folders sharing a parent, at least two of them, none yet folded into one `LocalRelease` - the
/// same directory shape `multi_disc` looks at, but grouped by path rather than a shared embedded id,
/// since a box's siblings frequently carry entirely different (and individually correct-looking)
/// embedded release ids (shape (b), see module docs).
async fn find_sibling_groups(pool: &PgPool) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
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
        SELECT f.id, f.folder_path, f.parent, f.majority_mb
        FROM f
        WHERE f.parent IN (SELECT parent FROM f GROUP BY parent HAVING count(*) > 1)
        ORDER BY f.parent, f.folder_path
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut groups: Vec<SiblingGroup> = Vec::new();
    for (id, folder_path, parent, majority_mb) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            majority_mb_release_id: majority_mb,
        };
        match groups.last_mut() {
            Some(g) if g.parent == parent => g.rows.push(row),
            _ => groups.push(SiblingGroup {
                parent,
                rows: vec![row],
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

#[allow(clippy::too_many_arguments)]
async fn apply_box_bind(
    pool: &PgPool,
    siblings: &[BoxSibling],
    fetched: &FetchedCandidate,
    plan: &BoxBindPlan,
    release_type_cache: &mut HashMap<String, String>,
    artist_id: &str,
    artist_genre_ids: &[String],
) -> Result<(), sqlx::Error> {
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

    let folder_by_id: HashMap<&str, &str> = siblings
        .iter()
        .map(|s| (s.local_id.as_str(), s.folder_path.as_str()))
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
           SET "groupKey" = $1, "folderPath" = $2, "releaseId" = $3,
               "matchStatus" = $4::"ReleaseStatus", "updatedAt" = $5
           WHERE id = $6"#,
    )
    .bind(format!("mbrelease:{}", plan.release_id))
    .bind(&plan.folder_path)
    .bind(&mb_db_id)
    .bind(status)
    .bind(now)
    .bind(&plan.survivor)
    .execute(&mut *tx)
    .await?;

    // One LocalReleaseMember per sibling (survivor included) so a plain re-index recognises every
    // folder next time instead of re-splitting a box whose discs all tag discNumber=1 (shape (b)).
    for (local_id, position) in &plan.members {
        let folder = folder_by_id.get(local_id.as_str()).copied().unwrap_or_default();
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

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct BoxSetSummary {
    pub groups_seen: usize,
    pub groups_bound: usize,
    pub rows_absorbed: usize,
}

#[allow(clippy::too_many_arguments)]
pub async fn run_repair(
    pool: &PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &Reporter,
    dry_run: bool,
    verbose: bool,
    only: &str,
    exact: bool,
) -> Result<BoxSetSummary, sqlx::Error> {
    let mut groups = find_sibling_groups(pool).await?;
    // The parent folder always starts with the artist's own folder name, so the same
    // semicolon-separated prefix/exact filter every other sync mode uses works here unchanged.
    if !only.is_empty() {
        groups.retain(|g| common::filters::matches_filter(&g.parent, "", "", only, exact));
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

    for (idx, group) in groups.into_iter().enumerate() {
        if group.rows.len() < 2 {
            continue;
        }
        reporter.item("Group", &group.parent, idx + 1, total);
        if verbose {
            reporter.sub_step(&format!("{} sibling folder(s):", group.rows.len()));
            for r in &group.rows {
                reporter.sub_step(&format!(
                    "  [{}] embedded id: {}",
                    r.folder_path,
                    r.majority_mb_release_id.as_deref().unwrap_or("(none)")
                ));
            }
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
            candidates_from_embedded_ids(http_client, limiter, &embedded_ids, reporter, verbose).await;
        if fetched.is_empty() {
            let title = guess_box_title(&group.parent);
            fetched =
                candidates_from_search(http_client, limiter, &title, &artist_name, reporter, verbose)
                    .await;
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
            "{} {} -> {} ({} row(s) absorbed, {}/{} discs owned)",
            "▸".cyan(),
            plan.release_id,
            plan.folder_path,
            plan.absorbed.len(),
            plan.members.len(),
            fetched.candidate.media.len(),
        );
        for s in &siblings {
            let mark = if s.local_id == plan.survivor {
                "KEEP ".green().bold()
            } else {
                "merge".yellow()
            };
            println!("    {} {} [{}]", mark, s.local_id, s.folder_path);
        }

        summary.groups_bound += 1;
        summary.rows_absorbed += plan.absorbed.len();
        if dry_run {
            continue;
        }

        let artist_genre_ids = get_artist_genre_ids(pool, &artist_id).await;
        apply_box_bind(
            pool,
            &siblings,
            fetched,
            &plan,
            &mut release_type_cache,
            &artist_id,
            &artist_genre_ids,
        )
        .await?;
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
