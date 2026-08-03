use chrono::NaiveDateTime;
use serde_json::Value as JsonValue;

#[derive(Debug, Clone)]
pub struct TrackMeta {
    pub file_path: String,
    pub file_size: i64,
    pub mtime: NaiveDateTime,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i32>,
    pub bitrate: Option<i32>,
    pub sample_rate: Option<i32>,
    pub position: Option<String>,
    pub content_hash: String,
    pub metadata_json: JsonValue,
    pub has_picture: bool,
    pub mb_release_id: Option<String>,
    pub mb_release_group_id: Option<String>,
    pub mb_album_artist_id: Option<String>,
    /// Every value of the multi-value `Artists`/`TrackArtists` frame, in file order.
    pub artists: Vec<String>,
    /// Every value of the multi-value `AlbumArtists` frame, in file order.
    pub album_artists: Vec<String>,
    /// Every value of the multi-value `MusicBrainzArtistId` frame, in file order. When this has the
    /// same length as `artists` (and more than one entry), the two zip into an authoritative
    /// name->MBID artist list - Picard already did the splitting, so no separator guessing or API call
    /// is needed. See `common::mb::resolve`.
    pub mb_artist_ids: Vec<String>,
    /// Same pairing, for `album_artists`.
    pub mb_album_artist_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MatchStatus {
    Complete,
    Incomplete,
    ExtraTracks,
    Missing,
    Unknown,
    Unmatched,
}

impl MatchStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "COMPLETE",
            Self::Incomplete => "INCOMPLETE",
            Self::ExtraTracks => "EXTRA_TRACKS",
            Self::Missing => "MISSING",
            Self::Unknown => "UNKNOWN",
            Self::Unmatched => "UNMATCHED",
        }
    }
}
