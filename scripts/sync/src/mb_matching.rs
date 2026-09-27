use std::collections::{HashMap, HashSet};

use common::artists::split_artists;
use common::filters::sanitize_mb_id;
use common::mb::cache::cached_exact_artist;
use common::mb::names::mb_artist_exact;
use sqlx::PgPool;

use crate::mb_api::*;
use crate::mb_types::*;
use reqwest::Client;

// ---------------------------------------------------------------------------
// Known special MusicBrainz artist IDs (not real artists)
// ---------------------------------------------------------------------------

const SPECIAL_MB_ARTIST_IDS: &[&str] = &[
    "89ad4ac3-39f7-470e-963a-56509c546377", // Various Artists
    "f731ccc4-e22a-43af-a747-64213329e088", // [anonymous]
    "33cf029c-63b0-41a0-9855-be2a3665fb3b", // [data]
    "314e1c25-dde7-4e4d-b2f4-0a7b032fa3c6", // [dialogue]
    "eec63d3c-3b81-4ad4-b1e4-7c147c4d2b61", // [no artist]
    "125ec42a-7229-4250-afc5-e057484327fe", // [traditional]
    "9be7f096-97ec-4615-8957-8c3b0b15e4e0", // [unknown]
];

pub fn is_special_artist_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "various artists"
        || lower == "various"
        || lower == "va"
        || lower.starts_with("various artists,")
        || lower.starts_with("various artists &")
        || lower.starts_with("various artists /")
        || lower == "unknown"
        || lower == "[unknown]"
}

pub fn is_special_mb_artist(id: &str, name: &str) -> bool {
    SPECIAL_MB_ARTIST_IDS.contains(&id) || is_special_artist_name(name)
}

// ---------------------------------------------------------------------------
// Name normalisation + similarity
// ---------------------------------------------------------------------------

// Single definition lives in `common::mb::names` - shared with the index resolver so the two binaries
// can never drift on what "the same artist" means. Re-exported here for sync's existing call sites.
pub use common::mb::names::{names_are_similar, normalize_name};

// ---------------------------------------------------------------------------
// 6-step artist matching
// ---------------------------------------------------------------------------

/// Which of several same-named MusicBrainz artists an artist row is, judged by its own albums: each candidate scores
/// one point per local album whose title is one of the candidate's release groups, with a matching year (±1) as the
/// tiebreak. Only a clear winner with at least one album in common counts - a tie or no overlap is no answer, and
/// the row stays unidentified rather than borrowing another artist's catalogue. Pure, for tests.
///
/// `local` is (title, year) per owned album; `candidates` is (MB artist id, [(release-group title, year)]).
pub fn pick_homonym(local: &[(String, Option<i32>)], candidates: &[(String, Vec<(String, Option<i32>)>)]) -> Option<String> {
    let norm = common::homonyms::normalize_title;
    let mut scored: Vec<(usize, usize, &String)> = candidates
        .iter()
        .map(|(id, groups)| {
            let mut titles = 0;
            let mut years = 0;
            for (title, year) in local {
                let t = norm(title);
                if t.is_empty() {
                    continue;
                }
                let hits: Vec<&Option<i32>> = groups.iter().filter(|(g, _)| norm(g) == t).map(|(_, y)| y).collect();
                if hits.is_empty() {
                    continue;
                }
                titles += 1;
                if let Some(y) = year {
                    if hits.iter().any(|gy| gy.is_some_and(|gy| (gy - y).abs() <= 1)) {
                        years += 1;
                    }
                }
            }
            (titles, years, id)
        })
        .collect();
    scored.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
    match scored.as_slice() {
        [best, ..] if best.0 == 0 => None,
        [best] => Some(best.2.clone()),
        [best, second, ..] if (best.0, best.1) > (second.0, second.1) => Some(best.2.clone()),
        _ => None,
    }
}

/// `pick_homonym` fed from the database (the row's owned albums) and MusicBrainz (one release-group browse per
/// candidate - only ever for a name several artists share).
async fn choose_homonym(
    client: &Client,
    pool: &PgPool,
    artist_id: &str,
    candidates: &[MbArtistMatch],
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    let local: Vec<(String, Option<i32>)> = sqlx::query_as(
        r#"SELECT DISTINCT lr.title, lr.year FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           WHERE lra."artistId" = $1"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    if local.is_empty() {
        return Ok(None);
    }
    let mut scored = Vec::new();
    for c in candidates {
        let groups = mb_get_release_groups(client, &c.id, limiter).await?;
        let groups: Vec<(String, Option<i32>)> = groups
            .into_iter()
            .map(|g| {
                let year = g.first_release_date.as_deref().and_then(|d| d.get(..4)).and_then(|y| y.parse().ok());
                (g.title, year)
            })
            .collect();
        scored.push((c.id.clone(), groups));
    }
    Ok(pick_homonym(&local, &scored).and_then(|id| candidates.iter().find(|c| c.id == id).cloned()))
}

/// Returns the best MbArtistMatch for the given artist, or None.
///
/// Algorithm:
///   1. If Artist.musicbrainzId is already set → direct lookup
///   2. If any track has mbReleaseGroupId → look up release group → get artist credits
///   3. Search MB by stored artist name
///   4. Search by raw artist/albumArtist tags from DB
///   5. Search MB for a release-group by album title + tag → use artist-credit array
///   6. Split tags by separators and search each part
///
/// Every search step (3, 4, 6) consults `MbArtistLookup` first - the index resolver has usually already
/// asked MusicBrainz about these exact strings, and re-asking is the single largest avoidable cost in a
/// sync run. Only cached *hits* count: a cached miss is the strict resolver's answer, and the fuzzy
/// search here may still match where the strict one didn't, so a miss falls through. Nothing here ever
/// writes to that table - see `common::mb::cache`.
///
/// `warmed` holds the bulk-loaded cache entries for the artist names known before the run started;
/// tags discovered mid-ladder fall back to a point lookup.
pub async fn find_mb_match_with_fallback(
    client: &Client,
    pool: &PgPool,
    artist_id: &str,
    artist_name: &str,
    mb_hint_artist_id: Option<&str>,
    limiter: &mut RateLimiter,
    warmed: &HashMap<String, MbArtistMatch>,
) -> Result<Option<MbArtistMatch>, String> {
    /// A cached exact hit for `name`, unless it names a non-artist placeholder.
    async fn cache_hit(
        pool: &PgPool,
        warmed: &HashMap<String, MbArtistMatch>,
        name: &str,
    ) -> Option<MbArtistMatch> {
        let m = match warmed.get(name) {
            Some(m) => m.clone(),
            None => cached_exact_artist(pool, name).await?,
        };
        (!is_special_mb_artist(&m.id, &m.name)).then_some(m)
    }

    // Step 1: direct lookup via embedded MUSICBRAINZ_ALBUMARTISTID
    if let Some(mb_aid) = mb_hint_artist_id.and_then(sanitize_mb_id) {
        if SPECIAL_MB_ARTIST_IDS.contains(&mb_aid.as_str()) {
            // skip
        } else {
            match mb_lookup_artist(client, &mb_aid, limiter).await {
                Ok(m) if is_special_mb_artist(&m.id, &m.name) => {}
                // A stored/embedded id only counts once the name it actually resolves to is
                // certainly this row's name - never just "we had an id, so it must be right". A
                // wrong id must fall through to the rest of the ladder (or end in None) instead of
                // being echoed back, or it can never self-correct. See docs/sync_decisions.md §4-6.
                Ok(m) if mb_artist_exact(artist_name, &m) => {
                    return Ok(Some(m));
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
    }

    // Step 2: lookup via first available mbReleaseGroupId → release group artist credits
    // Only use mbReleaseGroupId here - mbReleaseId is a release (not group) and would 404
    let mb_rg_id_hint: Option<String> = sqlx::query_as::<_, (String,)>(
        r#"SELECT DISTINCT lrt."mbReleaseGroupId"
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
           WHERE EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" lra
               WHERE lra."localReleaseId" = lr.id AND lra."artistId" = $1
           )
           AND lrt."mbReleaseGroupId" IS NOT NULL AND lrt."mbReleaseGroupId" != ''
           LIMIT 1"#,
    )
    .bind(artist_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|(id,)| id)
    .and_then(|raw| sanitize_mb_id(&raw));

    if let Some(ref mb_rid) = mb_rg_id_hint {
        match mb_lookup_release_group_artist(client, mb_rid, limiter).await {
            Ok(artists) if !artists.is_empty() => {
                let real_artists: Vec<MbArtistMatch> = artists
                    .into_iter()
                    .filter(|a| !is_special_mb_artist(&a.id, &a.name))
                    .collect();
                // Exact only - a release-group credit list can include co-credited artists (a
                // remixer, a compilation's other contributor) with a similar name, and this rung
                // has no other evidence to prefer the right one.
                if !real_artists.is_empty() {
                    if let Some(matched) = real_artists
                        .iter()
                        .find(|a| mb_artist_exact(artist_name, a))
                    {
                        return Ok(Some(matched.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    // Step 3: search MB by stored artist name. Exact search only - this rung is the row's own name
    // with nothing to disambiguate it against, so a merely-similar candidate (`mb_search_artist`'s
    // Jaccard >= 0.5) has no independent evidence backing it at all.
    if let Some(m) = cache_hit(pool, warmed, artist_name).await {
        return Ok(Some(m));
    }
    let exact = mb_search_artist_exact_all(client, artist_name, limiter).await?;
    let real: Vec<MbArtistMatch> = exact.into_iter().filter(|m| !is_special_mb_artist(&m.id, &m.name)).collect();
    // Several artists are exactly this name (docs/sync_decisions.md "Two artists, one name"). The name alone proves
    // nothing, so only the albums can decide: the candidate whose MusicBrainz catalogue holds this row's albums.
    let ambiguous = real.len() > 1;
    if ambiguous {
        if let Some(m) = choose_homonym(client, pool, artist_id, &real, limiter).await? {
            return Ok(Some(m));
        }
    }
    else if let Some(m) = real.into_iter().next() {
        return Ok(Some(m));
    }

    // Fetch distinct (artist_tag, albumArtist_tag, album_title) combos for this artist.
    let tag_rows: Vec<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT DISTINCT lrt.artist, lrt."albumArtist", lr.title
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
           WHERE EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" lra
               WHERE lra."localReleaseId" = lr.id AND lra."artistId" = $1
           ) OR EXISTS (
               SELECT 1 FROM "TrackRelatedArtist" tra
               WHERE tra."trackId" = lrt.id AND tra."artistId" = $1
           )"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Build deduplicated list of (tag, album_title) pairs to try for Steps 4-6.
    let mut all_tags: Vec<(String, Option<String>)> = Vec::new();
    let mut seen_tags: HashSet<String> = HashSet::new();

    {
        let key = artist_name.to_lowercase();
        seen_tags.insert(key);
        let title = tag_rows.first().and_then(|(_, _, t)| t.clone());
        all_tags.push((artist_name.to_string(), title));
    }

    for (raw_artist, raw_album_artist, album_title) in &tag_rows {
        if let Some(a) = raw_artist {
            let a = a.trim();
            if !a.is_empty() {
                let key = a.to_lowercase();
                if seen_tags.insert(key) {
                    all_tags.push((a.to_string(), album_title.clone()));
                }
            }
        }
        if let Some(aa) = raw_album_artist {
            let aa = aa.trim();
            if !aa.is_empty() {
                let key = aa.to_lowercase();
                if seen_tags.insert(key) {
                    all_tags.push((aa.to_string(), album_title.clone()));
                }
            }
        }
    }

    // Filter: only keep tags related to artist_name (containment or similarity).
    let artist_name_norm = normalize_name(artist_name);
    let artist_words: HashSet<String> = artist_name_norm
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    all_tags.retain(|(tag, _)| {
        if tag.eq_ignore_ascii_case(artist_name) {
            return true;
        }
        let tag_norm = normalize_name(tag);
        let tag_words: HashSet<&str> = tag_norm.split_whitespace().collect();
        let artist_word_refs: HashSet<&str> = artist_words.iter().map(|s| s.as_str()).collect();
        // Deliberately one-directional: a tag whose words are a SUBSET of the artist's own name is a
        // harmless partial spelling ("Miles" for "Miles Davis"). The other direction - the artist's
        // name being a subset of the tag's words - is what let a compound credit like "<name> Quintet"
        // or "<name> with <someone else>" get tried at all, and every candidate it returns still has
        // to pass the exact-name gate below, so admitting it here bought nothing but risk. Dropped.
        tag_words.is_subset(&artist_word_refs) || names_are_similar(artist_name, tag)
    });

    // Step 4: try raw tags (excluding artist_name itself) as single artist names. The tag only ever
    // picks which name to *search*; whatever comes back must still certainly be this row's own
    // artist_name; a tag ("<name> Quintet") pulling in a candidate that is really a different act
    // sharing the tag's words is exactly the leak this gate exists to close.
    // A shared name gets no further by searching other spellings of itself: every one of them is equally
    // ambiguous. Only the album-title rung below (step 5) carries evidence.
    for (tag, _) in all_tags.iter().filter(|_| !ambiguous) {
        if tag.eq_ignore_ascii_case(artist_name) {
            continue;
        }
        if let Some(m) = cache_hit(pool, warmed, tag).await {
            if mb_artist_exact(artist_name, &m) {
                return Ok(Some(m));
            }
            continue;
        }
        if let Some(m) = mb_search_artist(client, tag, limiter).await? {
            if is_special_mb_artist(&m.id, &m.name) {
                continue;
            }
            if mb_artist_exact(artist_name, &m) {
                return Ok(Some(m));
            }
        }
    }

    // Step 5: search MB for a release-group by album title + tag,
    // use the structured artist-credit array to find the artist.
    for (tag, album_title) in &all_tags {
        if let Some(ref title) = album_title {
            if let Some(m) =
                try_release_group_credits(client, title, tag, artist_name, limiter).await?
            {
                return Ok(Some(m));
            }
        }
    }

    // Step 6: the whole raw tag never resolved (steps 3-5) - split it by separators
    // (feat./&/,/;// etc., via the same splitter the unsplit-artist fix uses) and search each
    // individual member. Picks up compound tags like "Artist A & Artist B" where neither the
    // combined tag nor a plain-name search for it matches anything in MB.
    let mut seen_parts: HashSet<String> = seen_tags;
    for (tag, _) in all_tags.iter().filter(|_| !ambiguous) {
        let (mains, feats) = split_artists(tag);
        for part in mains.iter().chain(feats.iter()) {
            let key = part.to_lowercase();
            if !seen_parts.insert(key) {
                continue;
            }
            if let Some(m) = cache_hit(pool, warmed, part).await {
                if mb_artist_exact(artist_name, &m) {
                    return Ok(Some(m));
                }
                continue;
            }
            if let Some(m) = mb_search_artist(client, part, limiter).await? {
                if is_special_mb_artist(&m.id, &m.name) {
                    continue;
                }
                if mb_artist_exact(artist_name, &m) {
                    return Ok(Some(m));
                }
            }
        }
    }

    Ok(None)
}

// ---------------------------------------------------------------------------
// Step 5 helper: release-group credits
// ---------------------------------------------------------------------------

async fn try_release_group_credits(
    client: &Client,
    album_title: &str,
    artist_tag: &str,
    artist_name: &str,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    let credits = mb_search_release_group_credits(client, album_title, artist_tag, limiter)
        .await
        .unwrap_or_default();
    let real_credits: Vec<MbArtistMatch> = credits
        .into_iter()
        .filter(|a| !is_special_mb_artist(&a.id, &a.name))
        .collect();
    if real_credits.is_empty() {
        return Ok(None);
    }

    // Find the credit that certainly IS our artist name - never the tag, and never merely-similar.
    // A fallback that hands back `real_credits[0]` whenever it is merely related to the *tag* is not
    // safe here: a compound credit array ("<name> Quintet" and "<someone else>") would leak another
    // artist's id onto this row. See docs/sync_decisions.md §4-6.
    if let Some(matched) = real_credits
        .iter()
        .find(|c| mb_artist_exact(artist_name, c))
    {
        return Ok(Some(matched.clone()));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    fn local(titles: &[(&str, i32)]) -> Vec<(String, Option<i32>)> {
        titles.iter().map(|(t, y)| (t.to_string(), Some(*y))).collect()
    }

    fn cand(id: &str, groups: &[(&str, i32)]) -> (String, Vec<(String, Option<i32>)>) {
        (id.to_string(), groups.iter().map(|(t, y)| (t.to_string(), Some(*y))).collect())
    }

    #[test]
    fn the_homonym_whose_catalogue_holds_the_albums_wins() {
        let l = local(&[("Senso Comum", 2019), ("Logo Se Vê", 2023)]);
        let c = [cand("pt", &[("Senso comum", 2019), ("Logo se ve", 2023)]), cand("kr", &[])];
        assert_eq!(pick_homonym(&l, &c).as_deref(), Some("pt"));
    }

    #[test]
    fn a_tie_or_no_overlap_is_no_answer() {
        let l = local(&[("Greatest Hits", 2000)]);
        let tie = [cand("a", &[("Greatest Hits", 1990)]), cand("b", &[("Greatest Hits", 1985)])];
        assert_eq!(pick_homonym(&l, &tie), None);
        let none = [cand("a", &[("Other", 2000)]), cand("b", &[])];
        assert_eq!(pick_homonym(&l, &none), None);
    }

    #[test]
    fn the_year_breaks_a_title_tie() {
        let l = local(&[("Greatest Hits", 2000)]);
        let c = [cand("a", &[("Greatest Hits", 1990)]), cand("b", &[("Greatest Hits", 2001)])];
        assert_eq!(pick_homonym(&l, &c).as_deref(), Some("b"));
    }

    #[test]
    fn more_albums_in_common_beats_fewer() {
        let l = local(&[("One", 2001), ("Two", 2002), ("Three", 2003)]);
        let c = [cand("a", &[("One", 2001)]), cand("b", &[("Two", 2002), ("Three", 2003)])];
        assert_eq!(pick_homonym(&l, &c).as_deref(), Some("b"));
    }

    use super::*;

    /// The ladder must take a warmed cache hit instead of searching MusicBrainz.
    ///
    /// `#[ignore]`d - it needs a pool for the steps that run before the cache consult. Point it at a
    /// disposable, migrated database, never the production `DATABASE_URL`:
    ///
    ///   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p sync -- --ignored --nocapture
    ///
    /// The fixture name is one MusicBrainz could never match, so if the cache consult were dropped the
    /// ladder would fall through every step and return `None` - a clean discriminator that needs no
    /// request counter.
    #[tokio::test]
    #[ignore]
    async fn a_warmed_cache_hit_short_circuits_the_search_ladder() {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
            "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
             against the production DATABASE_URL",
        );
        let pool = common::db::create_pool(&db_url, "test")
            .await
            .expect("connect");
        let name = "DMP Test Cached Artist (sync)";
        let mbid = "44444444-4444-4444-8444-444444444444";

        let mut warmed: HashMap<String, MbArtistMatch> = HashMap::new();
        warmed.insert(
            name.to_string(),
            common::mb::cache::match_from_cache_row(name, mbid.to_string(), None),
        );

        let mut limiter = RateLimiter::new();
        let client = Client::new();
        let found = find_mb_match_with_fallback(
            &client,
            &pool,
            "nonexistent-artist-id",
            name,
            None,
            &mut limiter,
            &warmed,
        )
        .await
        .expect("ladder errored");

        assert_eq!(
            found.map(|m| m.id).as_deref(),
            Some(mbid),
            "step 3 must return the cached hit rather than searching MusicBrainz"
        );
    }

    /// A cached hit that names a placeholder ("Various Artists" and friends) must be ignored, exactly
    /// as a live search result would be - otherwise the cache becomes a way to smuggle one in.
    #[test]
    fn special_artists_are_rejected_from_the_cache_too() {
        let m = common::mb::cache::match_from_cache_row(
            "Various Artists",
            "89ad4ac3-39f7-470e-963a-56509c546377".to_string(),
            None,
        );
        assert!(is_special_mb_artist(&m.id, &m.name));
    }
}
