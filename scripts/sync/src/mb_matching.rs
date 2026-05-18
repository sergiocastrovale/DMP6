use std::collections::HashSet;

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

pub fn normalize_name(name: &str) -> String {
    let lower = name.to_lowercase();
    let stripped = lower.strip_prefix("the ").unwrap_or(&lower);
    stripped
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn names_are_similar(a: &str, b: &str) -> bool {
    let na = normalize_name(a);
    let nb = normalize_name(b);
    if na == nb {
        return true;
    }

    let noise: HashSet<&str> = [
        "the", "and", "&", "a", "an",
        "of", "in", "on", "at", "to", "for", "with", "by", "from", "or",
        "is", "et", "und", "e", "y", "i",
    ].iter().copied().collect();

    let words_a: HashSet<&str> = na
        .split_whitespace()
        .filter(|w| !noise.contains(*w))
        .collect();
    let words_b: HashSet<&str> = nb
        .split_whitespace()
        .filter(|w| !noise.contains(*w))
        .collect();

    if words_a.is_empty() || words_b.is_empty() {
        return false;
    }

    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    intersection as f64 / union as f64 >= 0.5
}

// ---------------------------------------------------------------------------
// 6-step artist matching
// ---------------------------------------------------------------------------

/// Returns the best MbArtistMatch for the given artist, or None.
///
/// Algorithm:
///   1. If Artist.musicbrainzId is already set → direct lookup
///   2. If any track has mbReleaseGroupId → look up release group → get artist credits
///   3. Search MB by stored artist name
///   4. Search by raw artist/albumArtist tags from DB
///   5. Search MB for a release-group by album title + tag → use artist-credit array
///   6. Split tags by separators and search each part
pub async fn find_mb_match_with_fallback(
    client: &Client,
    pool: &PgPool,
    artist_id: &str,
    artist_name: &str,
    mb_hint_artist_id: Option<&str>,
    limiter: &mut RateLimiter,
) -> Result<Option<MbArtistMatch>, String> {
    // Step 1: direct lookup via embedded MUSICBRAINZ_ALBUMARTISTID
    if let Some(mb_aid) = mb_hint_artist_id {
        if SPECIAL_MB_ARTIST_IDS.contains(&mb_aid) {
            // skip
        } else {
            match mb_lookup_artist(client, mb_aid, limiter).await {
                Ok(m) if is_special_mb_artist(&m.id, &m.name) => {}
                Ok(m) => {
                    return Ok(Some(m));
                }
                Err(_) => {}
            }
        }
    }

    // Step 2: lookup via first available mbReleaseGroupId → release group artist credits
    // Only use mbReleaseGroupId here — mbReleaseId is a release (not group) and would 404
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
    .map(|(id,)| id);

    if let Some(ref mb_rid) = mb_rg_id_hint {
        match mb_lookup_release_group_artist(client, mb_rid, limiter).await {
            Ok(artists) if !artists.is_empty() => {
                let real_artists: Vec<MbArtistMatch> = artists
                    .into_iter()
                    .filter(|a| !is_special_mb_artist(&a.id, &a.name))
                    .collect();
                if !real_artists.is_empty() {
                    if let Some(matched) = real_artists.iter().find(|a| {
                        names_are_similar(artist_name, &a.name)
                            || a.name.eq_ignore_ascii_case(artist_name)
                    }) {
                        return Ok(Some(matched.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    // Step 3: search MB by stored artist name
    if let Some(m) = mb_search_artist(client, artist_name, limiter).await? {
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
        tag_words.is_subset(&artist_word_refs)
            || artist_word_refs.is_subset(&tag_words)
            || names_are_similar(artist_name, tag)
    });

    // Step 4: try raw tags (excluding artist_name itself) as single artist names
    for (tag, _) in &all_tags {
        if tag.eq_ignore_ascii_case(artist_name) {
            continue;
        }
        if let Some(m) = mb_search_artist(client, tag, limiter).await? {
            if is_special_mb_artist(&m.id, &m.name) {
                continue;
            }
            return Ok(Some(m));
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

    // Find the credit that matches our artist name
    if let Some(matched) = real_credits.iter().find(|c| {
        names_are_similar(artist_name, &c.name)
            || c.name.eq_ignore_ascii_case(artist_name)
    }) {
        return Ok(Some(matched.clone()));
    }

    // Fallback: return first credit if it's related to the tag
    let tag_norm = normalize_name(artist_tag);
    let tag_words: HashSet<&str> = tag_norm.split_whitespace().collect();
    if let Some(first) = real_credits.into_iter().next() {
        let c_norm = normalize_name(&first.name);
        let c_words: HashSet<&str> = c_norm.split_whitespace().collect();
        if c_words.is_subset(&tag_words)
            || tag_words.is_subset(&c_words)
            || names_are_similar(artist_tag, &first.name)
        {
            return Ok(Some(first));
        }
    }

    Ok(None)
}
