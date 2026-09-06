#![allow(dead_code)] // Fields required by serde Deserialize even if not read directly

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MbArtistSearchResult {
    pub artists: Vec<MbArtistMatch>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbArtistMatch {
    pub id: String,
    pub name: String,
    pub score: Option<u32>,
    /// Only populated by searches that request `inc=aliases` (the strict resolver path). An artist's
    /// aliases carry the legitimate alternate spellings - "Nurse With Wound" style names often differ
    /// from the tag only by punctuation or a localized variant.
    #[serde(default)]
    pub aliases: Option<Vec<MbAlias>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbAlias {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct MbReleaseGroupList {
    #[serde(rename = "release-groups")]
    pub release_groups: Vec<MbReleaseGroup>,
    #[serde(rename = "release-group-count")]
    pub release_group_count: Option<u32>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MbReleaseGroup {
    pub id: String,
    pub title: String,
    #[serde(rename = "primary-type")]
    pub primary_type: Option<String>,
    #[serde(rename = "secondary-types")]
    pub secondary_types: Option<Vec<String>>,
    #[serde(rename = "first-release-date")]
    pub first_release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MbRelease {
    pub id: String,
    pub title: String,
    pub date: Option<String>,
    pub status: Option<String>,
    pub disambiguation: Option<String>,
    pub packaging: Option<String>,
    pub country: Option<String>,
    pub media: Option<Vec<MbMedia>>,
}

#[derive(Debug, Deserialize)]
pub struct MbReleaseList {
    pub releases: Vec<MbRelease>,
}

#[derive(Debug, Deserialize)]
pub struct MbMedia {
    pub position: Option<u32>,
    pub format: Option<String>,
    /// Per-disc title on a multi-medium release (e.g. a 9CD box names each disc after the album it
    /// reprints - "Ring Ring", "Waterloo", ...). `None` on a single-medium release, which has
    /// nothing to distinguish a disc by.
    pub title: Option<String>,
    #[serde(rename = "track-count")]
    pub track_count: Option<u32>,
    pub tracks: Option<Vec<MbTrack>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbTrack {
    pub id: String,
    pub title: String,
    pub position: Option<u32>,
    pub length: Option<u64>,
    #[serde(default)]
    pub disc_number: Option<u32>,
    /// The recording this track performs - stable across every release/medium that reprints the
    /// same recording (a box-set disc and the standalone album it duplicates share this id, even
    /// though their own `id` and release-scoped `musicbrainzId` differ). This is the join key for
    /// MusicBrainzReleaseMedium.equivalentReleaseId - see docs/box_sets.md section 2.3.
    pub recording: Option<MbRecordingRef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbRecordingRef {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbArea {
    pub name: Option<String>,
    #[serde(rename = "iso-3166-1-codes")]
    pub iso_3166_1_codes: Option<Vec<String>>,
}

/// `Clone` because sync hands it to a spawned image-download task, which outlives the loop iteration.
#[derive(Debug, Clone, Deserialize)]
pub struct MbArtistDetail {
    pub id: String,
    pub name: String,
    pub area: Option<MbArea>,
    pub relations: Option<Vec<MbRelation>>,
    pub genres: Option<Vec<MbGenre>>,
    pub tags: Option<Vec<MbTag>>,
}

impl MbArtistDetail {
    pub fn country_code(&self) -> Option<&str> {
        self.area
            .as_ref()
            .and_then(|a| a.iso_3166_1_codes.as_ref())
            .and_then(|codes| codes.first())
            .map(|s| s.as_str())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbRelation {
    #[serde(rename = "type")]
    pub relation_type: String,
    pub url: Option<MbUrl>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbUrl {
    pub resource: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbGenre {
    pub name: String,
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MbTag {
    pub name: String,
    pub count: Option<i32>,
}
