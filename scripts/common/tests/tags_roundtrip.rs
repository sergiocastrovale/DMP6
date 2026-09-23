//! Real-file round trips for `common::tags`: every format the library holds, generated with ffmpeg
//! (the `sync/tests/catalogue_smoke.rs` pattern), written through the production helpers and read
//! back. Guards the release-track vs recording slot mix-up `write_mb_ids`'s stale-recording self-heal
//! corrects. Skips with a message when ffmpeg is not on PATH.

use common::tags::{write_mb_ids, MbTagIds};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use std::path::{Path, PathBuf};
use std::process::Command;

const RELEASE_TRACK: &str = "11111111-1111-4111-8111-111111111111";
const RECORDING: &str = "22222222-2222-4222-8222-222222222222";
const OTHER_RECORDING: &str = "33333333-3333-4333-8333-333333333333";
const ALBUM: &str = "44444444-4444-4444-8444-444444444444";

const FORMATS: &[(&str, &str)] = &[
    ("mp3", "libmp3lame"),
    ("flac", "flac"),
    ("m4a", "aac"),
    ("opus", "libopus"),
];

fn ffmpeg_available() -> bool {
    let ok = Command::new("ffmpeg").arg("-version").output().is_ok();
    if !ok {
        eprintln!("ffmpeg not on PATH - skipping tag round-trip test");
    }
    ok
}

fn fixture(ext: &str, codec: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dmp-tags-{}", cuid2::create_id()));
    std::fs::create_dir_all(&dir).expect("mkdir fixture dir");
    let file = dir.join(format!("fixture.{ext}"));
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=mono",
        ])
        .args(["-t", "1", "-c:a", codec])
        .args([
            "-metadata",
            "title=Fixture Title",
            "-metadata",
            "artist=Fixture Artist",
        ])
        .arg(&file)
        .status()
        .expect("spawn ffmpeg");
    assert!(status.success(), "ffmpeg failed to build {ext} fixture");
    file
}

fn get(path: &Path, key: ItemKey) -> Option<String> {
    let tagged = Probe::open(path).unwrap().read().unwrap();
    tagged
        .primary_tag()
        .and_then(|t| t.get_string(key).map(str::to_string))
}

fn title(path: &Path) -> Option<String> {
    let tagged = Probe::open(path).unwrap().read().unwrap();
    tagged
        .primary_tag()
        .and_then(|t| t.title().map(|s| s.to_string()))
}

// Seeds through the production writer with `force`: lofty's generic `Tag` can't store these ids in
// an MP3 at all (the bug `MbSlots` works around), so it can't be used to build the fixtures either.
// `release_track` stays unset so the self-heal never fires while seeding.
fn seed(path: &Path, recording: &str, album: Option<&str>) {
    let ids = MbTagIds {
        album,
        recording: Some(recording),
        ..Default::default()
    };
    assert!(write_mb_ids(path, &ids, true).unwrap());
    assert_eq!(
        get(path, ItemKey::MusicBrainzRecordingId).as_deref(),
        Some(recording)
    );
}

fn ffprobe_tag(path: &Path, key: &str) -> Option<String> {
    let out = Command::new("ffprobe")
        .args(["-v", "quiet", "-show_entries", "format_tags", "-of", "json"])
        .arg(path)
        .output()
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    json["format"]["tags"]
        .as_object()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, v)| v.as_str().map(str::to_string))
}

fn both_track_ids() -> MbTagIds<'static> {
    MbTagIds {
        album: Some(ALBUM),
        release_track: Some(RELEASE_TRACK),
        recording: Some(RECORDING),
        ..Default::default()
    }
}

#[test]
fn writes_release_track_and_recording_into_their_own_slots() {
    if !ffmpeg_available() {
        return;
    }
    for (ext, codec) in FORMATS {
        let file = fixture(ext, codec);
        assert!(
            write_mb_ids(&file, &both_track_ids(), false).unwrap(),
            "{ext}"
        );
        assert_eq!(
            get(&file, ItemKey::MusicBrainzTrackId).as_deref(),
            Some(RELEASE_TRACK),
            "{ext}"
        );
        assert_eq!(
            get(&file, ItemKey::MusicBrainzRecordingId).as_deref(),
            Some(RECORDING),
            "{ext}"
        );
        assert_eq!(title(&file).as_deref(), Some("Fixture Title"), "{ext}");
    }
}

#[test]
fn raw_keys_match_picard_names() {
    if !ffmpeg_available() {
        return;
    }
    let flac = fixture("flac", "flac");
    write_mb_ids(&flac, &both_track_ids(), false).unwrap();
    assert_eq!(
        ffprobe_tag(&flac, "MUSICBRAINZ_TRACKID").as_deref(),
        Some(RECORDING)
    );
    assert_eq!(
        ffprobe_tag(&flac, "MUSICBRAINZ_RELEASETRACKID").as_deref(),
        Some(RELEASE_TRACK)
    );

    let mp3 = fixture("mp3", "libmp3lame");
    write_mb_ids(&mp3, &both_track_ids(), false).unwrap();
    assert_eq!(
        ffprobe_tag(&mp3, "MusicBrainz Release Track Id").as_deref(),
        Some(RELEASE_TRACK)
    );
}

// lofty 0.24's generic ID3v2 resave erased Picard's TXXX `MusicBrainz Album Id` / `Release Group Id`
// / `Release Track Id` frames. ffmpeg writes those TXXX frames itself, so this seeds them without
// going through lofty at all, then forces a resave that only adds an album-artist id.
#[test]
fn mp3_resave_keeps_existing_musicbrainz_frames() {
    if !ffmpeg_available() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("dmp-tags-{}", cuid2::create_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("picard.mp3");
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=mono",
        ])
        .args(["-t", "1", "-c:a", "libmp3lame", "-id3v2_version", "3"])
        .args(["-metadata", &format!("MusicBrainz Album Id={ALBUM}")])
        .args([
            "-metadata",
            &format!("MusicBrainz Release Track Id={RELEASE_TRACK}"),
        ])
        .arg(&file)
        .status()
        .unwrap();
    assert!(status.success());
    assert_eq!(
        ffprobe_tag(&file, "MusicBrainz Album Id").as_deref(),
        Some(ALBUM)
    );

    let ids = MbTagIds {
        album_artist: Some(OTHER_RECORDING),
        ..Default::default()
    };
    assert!(write_mb_ids(&file, &ids, false).unwrap());

    assert_eq!(
        ffprobe_tag(&file, "MusicBrainz Album Id").as_deref(),
        Some(ALBUM)
    );
    assert_eq!(
        ffprobe_tag(&file, "MusicBrainz Release Track Id").as_deref(),
        Some(RELEASE_TRACK)
    );
    assert_eq!(
        ffprobe_tag(&file, "MusicBrainz Album Artist Id").as_deref(),
        Some(OTHER_RECORDING)
    );
}

#[test]
fn heals_a_release_track_id_in_the_recording_slot_without_force() {
    if !ffmpeg_available() {
        return;
    }
    for (ext, codec) in FORMATS {
        let file = fixture(ext, codec);
        seed(&file, RELEASE_TRACK, None);
        assert!(
            write_mb_ids(&file, &both_track_ids(), false).unwrap(),
            "{ext}"
        );
        assert_eq!(
            get(&file, ItemKey::MusicBrainzRecordingId).as_deref(),
            Some(RECORDING),
            "{ext}"
        );

        let unknown = fixture(ext, codec);
        seed(&unknown, RELEASE_TRACK, None);
        let ids = MbTagIds {
            recording: None,
            ..both_track_ids()
        };
        assert!(write_mb_ids(&unknown, &ids, false).unwrap(), "{ext}");
        assert_eq!(
            get(&unknown, ItemKey::MusicBrainzRecordingId),
            None,
            "{ext}"
        );
        assert_eq!(
            get(&unknown, ItemKey::MusicBrainzTrackId).as_deref(),
            Some(RELEASE_TRACK),
            "{ext}"
        );
    }
}

#[test]
fn keeps_a_genuine_recording_id_without_force() {
    if !ffmpeg_available() {
        return;
    }
    for (ext, codec) in FORMATS {
        let file = fixture(ext, codec);
        seed(&file, OTHER_RECORDING, None);
        write_mb_ids(&file, &both_track_ids(), false).unwrap();
        assert_eq!(
            get(&file, ItemKey::MusicBrainzRecordingId).as_deref(),
            Some(OTHER_RECORDING),
            "{ext}"
        );
    }
}
