use chrono::Utc;
use common::filters::sanitize_mb_id;
use common::types::TrackMeta;
use lofty::config::{ParseOptions, ParsingMode};
use lofty::prelude::*;
use lofty::probe::Probe;
use md5::{Digest, Md5};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub fn sanitize_tag(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            c != '\0' && !('\x01'..='\x1F').contains(&c) && !('\u{007F}'..='\u{009F}').contains(&c)
        })
        .collect()
}

pub fn extract_metadata(path: &Path, music_dir: &str) -> Result<TrackMeta, String> {
    let meta = fs::metadata(path).map_err(|e| format!("cannot stat file: {e}"))?;
    let file_size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
            chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0).map(|dt| dt.naive_utc())
        })
        .unwrap_or_else(|| Utc::now().naive_utc());

    let parse_opts = ParseOptions::new()
        .read_properties(true)
        .parsing_mode(ParsingMode::Relaxed);
    let tagged_file = Probe::open(path)
        .map_err(|e| format!("cannot open file: {e}"))?
        .options(parse_opts)
        .read()
        .map_err(|e| format!("cannot read tags: {e}"))?;

    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album_artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut year: Option<i32> = None;
    let mut genre: Option<String> = None;
    let mut track_number: Option<i32> = None;
    let mut disc_number: Option<i32> = None;
    let mut position: Option<String> = None;
    let mut all_tags: HashMap<String, String> = HashMap::new();
    let mut has_picture = false;
    // Multi-value frames. Picard writes one `Artists` and one `MusicBrainzArtistId` entry PER credited
    // artist, so when their counts line up the pair is an authoritative, already-split artist list with
    // MB ids attached - no API call, no separator guessing. `all_tags` (a HashMap) collapses these to
    // last-wins, which is why they are collected separately here.
    let mut artists_multi: Vec<String> = Vec::new();
    let mut album_artists_multi: Vec<String> = Vec::new();
    let mut mb_artist_ids: Vec<String> = Vec::new();
    let mut mb_album_artist_ids: Vec<String> = Vec::new();
    let mut mb_release_id: Option<String> = None;
    let mut mb_release_group_id: Option<String> = None;
    let mut mb_album_artist_id: Option<String> = None;

    for tag in tagged_file.tags() {
        if title.is_none() {
            title = tag.title().map(|s| s.to_string());
        }
        if !tag.pictures().is_empty() {
            has_picture = true;
        }

        for item in tag.items() {
            let key = format!("{:?}", item.key());
            if let lofty::tag::ItemValue::Text(raw_val) = item.value() {
                let val = sanitize_tag(raw_val);
                let key_upper = key.to_uppercase();
                // Same key, three spellings depending on container and on whether lofty mapped it to a
                // generic ItemKey: "MUSICBRAINZ_ALBUMID" (raw Vorbis), "MusicBrainz Album Id" (TXXX),
                // "MusicBrainzReleaseId" (lofty's ItemKey Debug name). Comparing on an
                // alphanumeric-only, uppercased key collapses all three so a match can't be missed on
                // punctuation alone - which is exactly how mbReleaseId and mbAlbumArtistId silently
                // never populated (lofty says ...ReleaseId / ...ReleaseArtistId, the old checks looked
                // only for ...AlbumId / ...AlbumArtistId).
                let key_norm: String = key_upper
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric())
                    .collect();

                // All of these collapse to one check against the normalized key: "ALBUMARTIST",
                // "ALBUM_ARTIST" and "ALBUM ARTIST" are the same tag spelled three ways.
                if album_artist.is_none() && key_norm == "ALBUMARTIST" {
                    album_artist = Some(val.clone());
                }
                if track_number.is_none() && (key_norm == "TRACKNUMBER" || key_norm == "TRACK") {
                    track_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if disc_number.is_none() && (key_norm == "DISCNUMBER" || key_norm == "DISC") {
                    disc_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if position.is_none() && key_norm == "POSITION" {
                    position = Some(val.clone());
                }
                // MUSICBRAINZ_ALBUMID / "MusicBrainz Album Id" / lofty's MusicBrainzReleaseId.
                if mb_release_id.is_none()
                    && (key_norm == "MUSICBRAINZALBUMID" || key_norm == "MUSICBRAINZRELEASEID")
                {
                    mb_release_id = sanitize_mb_id(&val);
                }
                if mb_release_group_id.is_none() && key_norm == "MUSICBRAINZRELEASEGROUPID" {
                    mb_release_group_id = sanitize_mb_id(&val);
                }
                // MUSICBRAINZ_ALBUMARTISTID / lofty's MusicBrainzReleaseArtistId.
                if mb_album_artist_id.is_none()
                    && (key_norm == "MUSICBRAINZALBUMARTISTID"
                        || key_norm == "MUSICBRAINZRELEASEARTISTID")
                {
                    mb_album_artist_id = sanitize_mb_id(&val);
                }

                // Collect EVERY value of the multi-value frames, in file order, so the Nth artist
                // pairs with the Nth MB id.
                if key_norm == "TRACKARTISTS" || key_norm == "ARTISTS" {
                    if !val.trim().is_empty() {
                        artists_multi.push(val.trim().to_string());
                    }
                }
                if key_norm == "ALBUMARTISTS" {
                    if !val.trim().is_empty() {
                        album_artists_multi.push(val.trim().to_string());
                    }
                }
                if key_norm == "MUSICBRAINZARTISTID" {
                    if let Some(id) = sanitize_mb_id(&val) {
                        mb_artist_ids.push(id);
                    }
                }
                if key_norm == "MUSICBRAINZALBUMARTISTID"
                    || key_norm == "MUSICBRAINZRELEASEARTISTID"
                {
                    if let Some(id) = sanitize_mb_id(&val) {
                        mb_album_artist_ids.push(id);
                    }
                }

                all_tags.insert(key, val.clone());
            }
        }

        if artist.is_none() {
            artist = tag.artist().map(|s| s.to_string());
        }
        if album.is_none() {
            album = tag.album().map(|s| s.to_string());
        }
        if year.is_none() {
            year = tag.date().map(|d| d.year as i32);
        }
        if genre.is_none() {
            genre = tag.genre().map(|s| s.to_string());
        }
    }

    let props = tagged_file.properties();
    let duration = Some(props.duration().as_secs() as i32);
    let bitrate = props.audio_bitrate().map(|b| b as i32);
    let sample_rate = props.sample_rate().map(|s| s as i32);

    let hash_input = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        artist.as_deref().unwrap_or("").to_lowercase(),
        album_artist.as_deref().unwrap_or("").to_lowercase(),
        album.as_deref().unwrap_or("").to_lowercase(),
        title.as_deref().unwrap_or("").to_lowercase(),
        year.unwrap_or(0),
        track_number.unwrap_or(0),
        disc_number.unwrap_or(0),
        genre.as_deref().unwrap_or("").to_lowercase(),
    );
    let mut hasher = Md5::new();
    hasher.update(hash_input.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());

    let excluded_keys: &[&str] = &[
        "ARTIST",
        "TITLE",
        "ALBUM",
        "YEAR",
        "DATE",
        "GENRE",
        "TRACKNUMBER",
        "TRACK",
        "DISCNUMBER",
        "DISC",
        "ALBUMARTIST",
        "ALBUM_ARTIST",
        "ALBUM ARTIST",
    ];
    let mut meta_map = serde_json::Map::new();
    for (k, v) in &all_tags {
        let k_upper = k.to_uppercase();
        if !excluded_keys.iter().any(|e| k_upper == *e) && !v.trim().is_empty() {
            meta_map.insert(k.clone(), JsonValue::String(v.clone()));
        }
    }
    let metadata_json = JsonValue::Object(meta_map);

    let path_str = path.to_string_lossy();
    let relative_path = path_str
        .strip_prefix(music_dir)
        .unwrap_or(&path_str)
        .trim_start_matches('/')
        .to_string();

    Ok(TrackMeta {
        file_path: relative_path,
        file_size,
        mtime,
        title,
        artist,
        album_artist,
        album,
        year,
        genre,
        track_number,
        disc_number,
        duration,
        bitrate,
        sample_rate,
        position,
        content_hash,
        metadata_json,
        has_picture,
        mb_release_id,
        mb_release_group_id,
        mb_album_artist_id,
        artists: artists_multi,
        album_artists: album_artists_multi,
        mb_artist_ids,
        mb_album_artist_ids,
    })
}
