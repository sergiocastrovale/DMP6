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

/// Returns true when `artist_name` is a compound name that contains `match_name`
/// as a component (e.g. "070 Shake & Christine and the Queens" contains "070 Shake").
pub fn is_likely_compound_of(artist_name: &str, match_name: &str) -> bool {
    let an = normalize_name(artist_name);
    let mn = normalize_name(match_name);
    if an == mn {
        return false;
    }

    let lower = artist_name.to_lowercase();

    // Unambiguous compound separators — always indicate multiple artists
    if lower.contains(" vs ")
        || lower.contains(" vs. ")
        || lower.contains(" – ")
        || lower.contains(" // ")
        || lower.contains(" | ")
        || lower.contains(" x ")
        || artist_name.contains('\\')
    {
        return true;
    }

    // Ambiguous separator: "&" only counts as compound if the match is a proper
    // subset of the artist name (the artist name has words beyond the match).
    if lower.contains(" & ") {
        let an_words: HashSet<&str> = an.split_whitespace().collect();
        let mn_words: HashSet<&str> = mn.split_whitespace().collect();
        if mn_words.is_subset(&an_words) && mn_words.len() < an_words.len() {
            return true;
        }
    }

    false
}

// ---------------------------------------------------------------------------
// 6-step artist matching
// ---------------------------------------------------------------------------

/// Returns (primary_match, additional_matches).
/// Primary is the match for the queried artist name.
/// Additional are other artists found from credits or compound splitting.
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
) -> Result<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>), String> {
    // Step 1: direct lookup via embedded MUSICBRAINZ_ALBUMARTISTID
    if let Some(mb_aid) = mb_hint_artist_id {
        if SPECIAL_MB_ARTIST_IDS.contains(&mb_aid) {
            // skip
        } else {
            match mb_lookup_artist(client, mb_aid, limiter).await {
                Ok(m) if is_special_mb_artist(&m.id, &m.name) => {}
                Ok(m) => {
                    return Ok((Some(m), Vec::new()));
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
                        let primary = matched.clone();
                        let additional: Vec<(String, MbArtistMatch)> = real_artists
                            .iter()
                            .filter(|a| a.id != primary.id)
                            .map(|a| (a.name.clone(), a.clone()))
                            .collect();
                        return Ok((Some(primary), additional));
                    }
                }
            }
            _ => {}
        }
    }

    // Step 3: search MB by stored artist name
    if let Some(m) = mb_search_artist(client, artist_name, limiter).await? {
        return Ok((Some(m), Vec::new()));
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
               SELECT 1 FROM "TrackArtist" ta
               WHERE ta."trackId" = lrt.id AND ta."artistId" = $1
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
    let mut early_primary: Option<MbArtistMatch> = None;
    for (tag, _) in &all_tags {
        if tag.eq_ignore_ascii_case(artist_name) {
            continue;
        }
        if let Some(m) = mb_search_artist(client, tag, limiter).await? {
            if is_special_mb_artist(&m.id, &m.name) {
                continue;
            }
            early_primary = Some(m);
            break;
        }
    }

    // Step 5: search MB for a release-group by album title + tag,
    // use the structured artist-credit array to resolve compound names.
    for (tag, album_title) in &all_tags {
        if let Some(ref title) = album_title {
            if let Some(result) =
                try_release_group_credits(client, title, tag, &early_primary, limiter).await?
            {
                return Ok(result);
            }
        }
    }

    // Step 6 (last resort): split tags by unambiguous separators only.
    for (tag, _) in &all_tags {
        if let Some(result) =
            try_split_tag(client, tag, artist_name, &early_primary, limiter).await?
        {
            return Ok(result);
        }
    }

    if early_primary.is_some() {
        return Ok((early_primary, Vec::new()));
    }

    Ok((None, Vec::new()))
}

// ---------------------------------------------------------------------------
// Step 5 helper: release-group credits
// ---------------------------------------------------------------------------

async fn try_release_group_credits(
    client: &Client,
    album_title: &str,
    artist_tag: &str,
    early_primary: &Option<MbArtistMatch>,
    limiter: &mut RateLimiter,
) -> Result<Option<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>)>, String> {
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

    // Validate: at least one credit name must be related to the artist_tag.
    let tag_norm = normalize_name(artist_tag);
    let tag_words: HashSet<&str> = tag_norm.split_whitespace().collect();
    let any_credit_matches = real_credits.iter().any(|c| {
        let c_norm = normalize_name(&c.name);
        let c_words: HashSet<&str> = c_norm.split_whitespace().collect();
        c_words.is_subset(&tag_words)
            || tag_words.is_subset(&c_words)
            || names_are_similar(artist_tag, &c.name)
    });
    if !any_credit_matches {
        return Ok(None);
    }

    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut primary: Option<MbArtistMatch> = None;
    let mut additional: Vec<(String, MbArtistMatch)> = Vec::new();
    let mut found_new = false;

    if let Some(ref ep) = early_primary {
        seen_ids.insert(ep.id.clone());
        primary = Some(ep.clone());
    }

    for credit in real_credits {
        if seen_ids.contains(&credit.id) {
            continue;
        }
        found_new = true;
        seen_ids.insert(credit.id.clone());
        if primary.is_none() {
            primary = Some(credit);
        } else {
            additional.push((credit.name.clone(), credit));
        }
    }

    if primary.is_some() && (early_primary.is_none() || found_new) {
        Ok(Some((primary, additional)))
    } else {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Step 6 helper: split compound tag
// ---------------------------------------------------------------------------

async fn try_split_tag(
    client: &Client,
    tag: &str,
    artist_name: &str,
    early_primary: &Option<MbArtistMatch>,
    limiter: &mut RateLimiter,
) -> Result<Option<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>)>, String> {
    let mut separators: Vec<&str> = vec![
        "// ", "//", "\\\\ ", "\\\\", "|| ", "||",
        " feat. ", " feat ", " vs. ", " vs ", " – ",
        " / ", " \\ ", "\\", "| ", "|", "; ", ";",
    ];
    // Only try ambiguous separators when we have a confirmed anchor artist.
    if early_primary.is_some() {
        separators.extend_from_slice(&["/", " & ", ", "]);
    }

    for sep in &separators {
        let parts: Vec<&str> = tag
            .split(sep)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }
        // If artist_name appears as one of the split parts, this tag won't help
        // us find artist_name's MB match — the other parts are different artists.
        if parts.iter().any(|p| p.eq_ignore_ascii_case(artist_name)) {
            continue;
        }

        let mut primary: Option<MbArtistMatch> = None;
        let mut additional: Vec<(String, MbArtistMatch)> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        if let Some(ref ep) = early_primary {
            seen_ids.insert(ep.id.clone());
            primary = Some(ep.clone());
        }

        for part in &parts {
            if let Some(ref ep) = early_primary {
                if part.eq_ignore_ascii_case(&ep.name) {
                    continue;
                }
            }
            if let Some(m) = mb_search_artist(client, part, limiter).await? {
                if seen_ids.contains(&m.id) {
                    continue;
                }
                seen_ids.insert(m.id.clone());
                if primary.is_none() {
                    primary = Some(m);
                } else {
                    additional.push((part.to_string(), m));
                }
            }
        }

        if primary.is_some() {
            return Ok(Some((primary, additional)));
        }
    }

    Ok(None)
}
