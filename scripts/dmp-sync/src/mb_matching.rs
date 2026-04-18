use std::collections::HashSet;

use crate::mb_api::*;
use crate::mb_types::*;
use dmp_common::types::TrackMeta;
use reqwest::Client;

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

    let noise: HashSet<&str> = ["the", "and", "&", "a", "an"].iter().copied().collect();

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

pub fn is_likely_compound_of(compound: &str, part: &str) -> bool {
    let nc = normalize_name(compound);
    let np = normalize_name(part);
    if np.is_empty() {
        return false;
    }
    let separators = [" & ", " and ", " feat ", " feat. ", " vs ", " vs. ", " / ", ", "];
    for sep in &separators {
        if nc.contains(sep) {
            return true;
        }
    }
    nc.contains(&np)
}

// ---------------------------------------------------------------------------
// Step 5: try release-group credits for compound resolution
// ---------------------------------------------------------------------------

pub async fn try_release_group_credits(
    client: &Client,
    limiter: &mut RateLimiter,
    artist_name: &str,
    tracks: &[&TrackMeta],
) -> Option<MbArtistMatch> {
    for track in tracks {
        let album = track.album.as_deref().unwrap_or("");
        if album.is_empty() {
            continue;
        }
        let credits =
            match mb_search_release_group_credits(client, album, artist_name, limiter).await {
                Ok(c) => c,
                Err(_) => continue,
            };
        for credit in credits {
            if names_are_similar(artist_name, &credit.name) {
                return Some(credit);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Step 6: try splitting the artist tag to find a component match
// ---------------------------------------------------------------------------

pub async fn try_split_tag(
    client: &Client,
    limiter: &mut RateLimiter,
    artist_name: &str,
) -> Option<MbArtistMatch> {
    let separators = [" & ", " and ", " feat. ", " feat ", " / ", ", "];
    for sep in &separators {
        if artist_name.contains(sep) {
            let parts: Vec<&str> = artist_name.split(sep).collect();
            for part in parts {
                let part = part.trim();
                if part.len() < 2 {
                    continue;
                }
                match mb_search_artist(client, part, limiter).await {
                    Ok(Some(m)) => return Some(m),
                    _ => continue,
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// 6-step artist matching
// ---------------------------------------------------------------------------

pub async fn find_mb_match_with_fallback(
    client: &Client,
    limiter: &mut RateLimiter,
    artist_name: &str,
    tracks: &[&TrackMeta],
) -> Result<Option<MbArtistMatch>, String> {
    // Step 1: embedded MB artist ID in any track tag
    for track in tracks {
        if let Some(ref mb_id) = track.mb_album_artist_id {
            if !mb_id.is_empty() {
                match mb_lookup_artist(client, mb_id, limiter).await {
                    Ok(m) => return Ok(Some(m)),
                    Err(_) => {}
                }
            }
        }
    }

    // Step 2: embedded MB album ID → release group → artist credits
    for track in tracks {
        if let Some(ref mb_album_id) = track.mb_album_id {
            if !mb_album_id.is_empty() {
                match mb_lookup_release_group_artist(client, mb_album_id, limiter).await {
                    Ok(credits) => {
                        for credit in credits {
                            if names_are_similar(artist_name, &credit.name) {
                                return Ok(Some(credit));
                            }
                        }
                    }
                    Err(_) => {}
                }
            }
        }
    }

    // Step 3: direct name search
    if let Some(m) = mb_search_artist(client, artist_name, limiter).await? {
        return Ok(Some(m));
    }

    // Step 4: raw tag artist fields (track.artist differs from album_artist)
    let raw_artists: Vec<&str> = tracks
        .iter()
        .filter_map(|t| t.artist.as_deref())
        .filter(|a| !a.is_empty() && !names_are_similar(artist_name, a))
        .collect();
    let mut seen = HashSet::new();
    for raw in raw_artists {
        if seen.insert(raw) {
            if let Ok(Some(m)) = mb_search_artist(client, raw, limiter).await {
                if names_are_similar(artist_name, &m.name) {
                    return Ok(Some(m));
                }
            }
        }
    }

    // Step 5: release-group credits (compound resolution)
    if let Some(m) = try_release_group_credits(client, limiter, artist_name, tracks).await {
        return Ok(Some(m));
    }

    // Step 6: split tag
    if is_likely_compound_of(artist_name, artist_name) {
        if let Some(m) = try_split_tag(client, limiter, artist_name).await {
            return Ok(Some(m));
        }
    }

    Ok(None)
}
