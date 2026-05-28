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
            c != '\0'
                && !('\x01'..='\x1F').contains(&c)
                && !('\u{007F}'..='\u{009F}').contains(&c)
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
            chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)
                .map(|dt| dt.naive_utc())
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

                if album_artist.is_none()
                    && (key_upper == "ALBUMARTIST"
                        || key_upper == "ALBUM_ARTIST"
                        || key_upper == "ALBUM ARTIST")
                {
                    album_artist = Some(val.clone());
                }
                if track_number.is_none()
                    && (key_upper == "TRACKNUMBER" || key_upper == "TRACK")
                {
                    track_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if disc_number.is_none()
                    && (key_upper == "DISCNUMBER" || key_upper == "DISC")
                {
                    disc_number = val.split('/').next().and_then(|s| s.trim().parse().ok());
                }
                if position.is_none() && key_upper == "POSITION" {
                    position = Some(val.clone());
                }
                if mb_release_id.is_none()
                    && (key_upper == "MUSICBRAINZ_ALBUMID"
                        || key_upper == "MUSICBRAINZ ALBUM ID"
                        || key_upper == "MUSICBRAINZALBUMID")
                {
                    mb_release_id = sanitize_mb_id(&val);
                }
                if mb_release_group_id.is_none()
                    && (key_upper == "MUSICBRAINZ_RELEASEGROUPID"
                        || key_upper == "MUSICBRAINZ RELEASE GROUP ID"
                        || key_upper.contains("MUSICBRAINZRELEASEGROUPID"))
                {
                    mb_release_group_id = sanitize_mb_id(&val);
                }
                if mb_album_artist_id.is_none()
                    && (key_upper == "MUSICBRAINZ_ALBUMARTISTID"
                        || key_upper == "MUSICBRAINZ ALBUM ARTIST ID"
                        || key_upper.contains("MUSICBRAINZALBUMARTISTID"))
                {
                    mb_album_artist_id = sanitize_mb_id(&val);
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
        "ARTIST", "TITLE", "ALBUM", "YEAR", "DATE", "GENRE",
        "TRACKNUMBER", "TRACK", "DISCNUMBER", "DISC",
        "ALBUMARTIST", "ALBUM_ARTIST", "ALBUM ARTIST",
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
    })
}
