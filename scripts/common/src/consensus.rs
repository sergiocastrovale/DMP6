//! No-guessing release placement (docs/no_guessing.md). A folder's release identity (album title,
//! embedded MusicBrainz release/release-group id) must be **unanimous** across its tracks - never a
//! plurality or majority vote. Anything short of unanimous produces a `Verdict` with a human-readable
//! `reason`, which the caller uses to park the release at `UNKNOWN` instead of guessing a placement.

use crate::filters::sanitize_mb_id;
use sqlx::PgPool;
use unicode_normalization::UnicodeNormalization;

pub const ALBUM_INEXISTENT: &str = "No track in the release folder has an 'album' metadata field";
pub const ALBUM_DIVERGENCE: &str =
    "Tracks in the release folder disagree in 'album' metadata field";
pub const ALBUM_MISSING: &str =
    "Some tracks in the release folder have no 'album' metadata field";
pub const MB_ALBUM_DIVERGENCE_RG_UNANIMOUS: &str =
    "Tracks carry different MUSICBRAINZ_ALBUMID but a unanimous MUSICBRAINZ_RELEASEGROUPID";
pub const MB_ALBUM_DIVERGENCE: &str =
    "Tracks in the release folder disagree on the embedded MusicBrainz album id";
pub const MB_RELEASE_GROUP_DIVERGENCE: &str =
    "Tracks in the release folder disagree on the embedded MusicBrainz release group id";

#[derive(Debug, Clone)]
pub struct TrackTags {
    pub id: String,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub mb_release_id: Option<String>,
    pub mb_release_group_id: Option<String>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AlbumVerdict {
    Unanimous(String),
    Divergent,
    PartiallyMissing(String),
    AllMissing,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IdVerdict {
    Unanimous(String),
    Divergent,
    Absent,
}

#[derive(Debug, Clone, Default)]
pub struct Verdict {
    pub title: Option<String>,
    pub year: Option<i32>,
    pub mb_release_id: Option<String>,
    pub mb_release_group_id: Option<String>,
    pub reason: Option<&'static str>,
}

/// trim -> NFC -> collapse internal whitespace runs to one space -> lowercase.
///
/// Deliberately NOT `common::mb::names::normalize_name`: that NFD-folds accents, strips a leading
/// "the " and drops punctuation - all too loose for release-placement identity, where "Rêverie" and
/// "Reverie" must be treated as different albums.
pub fn normalize_album(s: &str) -> String {
    let nfc: String = s.trim().nfc().collect();
    let mut out = String::with_capacity(nfc.len());
    let mut last_was_space = false;
    for c in nfc.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
            }
            last_was_space = true;
        } else {
            out.push(c);
            last_was_space = false;
        }
    }
    out.to_lowercase()
}

pub fn album_agreement(tracks: &[TrackTags]) -> AlbumVerdict {
    let mut first_original: Option<String> = None;
    let mut first_normalized: Option<String> = None;
    let mut divergent = false;
    let mut tagged = 0usize;

    for t in tracks {
        let Some(raw) = t.album.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        tagged += 1;
        let norm = normalize_album(raw);
        match &first_normalized {
            None => {
                first_normalized = Some(norm);
                first_original = Some(raw.to_string());
            }
            Some(existing) if *existing != norm => divergent = true,
            _ => {}
        }
    }

    if tagged == 0 {
        return AlbumVerdict::AllMissing;
    }
    if divergent {
        return AlbumVerdict::Divergent;
    }
    let title = first_original.unwrap();
    if tagged < tracks.len() {
        AlbumVerdict::PartiallyMissing(title)
    } else {
        AlbumVerdict::Unanimous(title)
    }
}

pub fn id_agreement<'a>(
    tracks: &'a [TrackTags],
    f: fn(&'a TrackTags) -> &'a Option<String>,
) -> IdVerdict {
    let mut winner: Option<String> = None;
    let mut divergent = false;

    for t in tracks {
        let Some(raw) = f(t).as_deref() else {
            continue;
        };
        let Some(clean) = sanitize_mb_id(raw) else {
            continue;
        };
        match &winner {
            None => winner = Some(clean),
            Some(existing) if *existing != clean => divergent = true,
            _ => {}
        }
    }

    if divergent {
        IdVerdict::Divergent
    } else {
        match winner {
            Some(id) => IdVerdict::Unanimous(id),
            None => IdVerdict::Absent,
        }
    }
}

pub fn year_agreement(tracks: &[TrackTags]) -> Option<i32> {
    let mut winner: Option<i32> = None;
    for t in tracks {
        let Some(y) = t.year else { continue };
        match winner {
            None => winner = Some(y),
            Some(existing) if existing != y => return None,
            _ => {}
        }
    }
    winner
}

pub fn folder_leaf(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

pub fn evaluate(tracks: &[TrackTags]) -> Verdict {
    let mut sorted: Vec<&TrackTags> = tracks.iter().collect();
    sorted.sort_by(|a, b| {
        (a.disc_number, a.track_number, a.file_path.as_deref().unwrap_or(""))
            .cmp(&(b.disc_number, b.track_number, b.file_path.as_deref().unwrap_or("")))
    });
    let sorted_tracks: Vec<TrackTags> = sorted.into_iter().cloned().collect();

    let year = year_agreement(&sorted_tracks);

    let album_verdict = album_agreement(&sorted_tracks);

    // 1: no track has a non-empty album tag
    if album_verdict == AlbumVerdict::AllMissing {
        return Verdict {
            title: None,
            year,
            mb_release_id: None,
            mb_release_group_id: None,
            reason: Some(ALBUM_INEXISTENT),
        };
    }
    // 2: >1 distinct normalized album among tagged tracks
    if album_verdict == AlbumVerdict::Divergent {
        return Verdict {
            title: None,
            year,
            mb_release_id: None,
            mb_release_group_id: None,
            reason: Some(ALBUM_DIVERGENCE),
        };
    }
    // 3: some tracks tagged, some not (album unanimous among tagged)
    if let AlbumVerdict::PartiallyMissing(ref title) = album_verdict {
        return Verdict {
            title: Some(title.clone()),
            year,
            mb_release_id: None,
            mb_release_group_id: None,
            reason: Some(ALBUM_MISSING),
        };
    }

    let title = match album_verdict {
        AlbumVerdict::Unanimous(ref t) => Some(t.clone()),
        _ => None,
    };

    let rel_verdict = id_agreement(&sorted_tracks, |t| &t.mb_release_id);
    let rg_verdict = id_agreement(&sorted_tracks, |t| &t.mb_release_group_id);

    // 4: >1 distinct sanitized mbReleaseId among tracks carrying one
    if rel_verdict == IdVerdict::Divergent {
        return match rg_verdict {
            // 4a: exactly 1 distinct sanitized mbReleaseGroupId among tracks carrying one
            IdVerdict::Unanimous(_) => Verdict {
                title,
                year,
                mb_release_id: None,
                mb_release_group_id: None,
                reason: Some(MB_ALBUM_DIVERGENCE_RG_UNANIMOUS),
            },
            // 4b: otherwise
            _ => Verdict {
                title,
                year,
                mb_release_id: None,
                mb_release_group_id: None,
                reason: Some(MB_ALBUM_DIVERGENCE),
            },
        };
    }

    // 5: >1 distinct sanitized mbReleaseGroupId among tracks carrying one (release ids unanimous or
    //    all absent)
    if rg_verdict == IdVerdict::Divergent {
        return Verdict {
            title,
            year,
            mb_release_id: None,
            mb_release_group_id: None,
            reason: Some(MB_RELEASE_GROUP_DIVERGENCE),
        };
    }

    // 6: otherwise - clean
    let mb_release_id = match rel_verdict {
        IdVerdict::Unanimous(id) => Some(id),
        _ => None,
    };
    let mb_release_group_id = match rg_verdict {
        IdVerdict::Unanimous(id) => Some(id),
        _ => None,
    };

    Verdict {
        title,
        year,
        mb_release_id,
        mb_release_group_id,
        reason: None,
    }
}

/// Unbind a release to UNKNOWN with a human-readable reason: clear its MB link + status + track MB
/// links, set the display title to the folder leaf name (no metadata left to display).
///
/// No-op (0 rows) for box-placed / member releases - those never get their placement from tags.
pub async fn mark_local_release_unknown(
    pool: &PgPool,
    id: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"UPDATE "LocalRelease"
             SET "releaseId"    = NULL,
                 "matchStatus"  = 'UNKNOWN'::"ReleaseStatus",
                 "statusReason" = $2,
                 title          = left(regexp_replace(COALESCE("folderPath", title), '^.*/', ''), 500),
                 "updatedAt"    = NOW()
           WHERE id = $1
             AND "boxReleaseId" IS NULL
             AND "mediumPosition" IS NULL
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = "LocalRelease".id)"#,
    )
    .bind(id)
    .bind(reason)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"UPDATE "LocalReleaseTrack"
             SET "mbTrackId" = NULL, "updatedAt" = NOW()
           WHERE "localReleaseId" = $1 AND "mbTrackId" IS NOT NULL"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(
        album: Option<&str>,
        year: Option<i32>,
        rel: Option<&str>,
        rg: Option<&str>,
    ) -> TrackTags {
        TrackTags {
            id: cuid2::create_id(),
            album: album.map(str::to_string),
            year,
            mb_release_id: rel.map(str::to_string),
            mb_release_group_id: rg.map(str::to_string),
            disc_number: None,
            track_number: None,
            file_path: None,
        }
    }

    #[test]
    fn normalize_album_case_spacing_variants_agree() {
        assert_eq!(normalize_album("  The   Album  "), normalize_album("the album"));
        assert_eq!(normalize_album("A\tB"), normalize_album("A B"));
    }

    #[test]
    fn normalize_album_nfc_variants_agree() {
        // "é" as precomposed vs combining-accent decomposed.
        let precomposed = "Caf\u{00e9}";
        let decomposed = "Cafe\u{0301}";
        assert_eq!(normalize_album(precomposed), normalize_album(decomposed));
    }

    #[test]
    fn normalize_album_deluxe_suffix_disagrees() {
        assert_ne!(normalize_album("X"), normalize_album("X (Deluxe)"));
    }

    #[test]
    fn normalize_album_accented_vs_unaccented_disagree() {
        assert_ne!(normalize_album("Rêverie"), normalize_album("Reverie"));
    }

    #[test]
    fn album_agreement_empty_string_counts_as_missing() {
        let tracks = vec![track(Some(""), None, None, None), track(Some("X"), None, None, None)];
        assert_eq!(
            album_agreement(&tracks),
            AlbumVerdict::PartiallyMissing("X".to_string())
        );
    }

    #[test]
    fn album_agreement_partial_vs_all_missing() {
        let all_missing = vec![track(None, None, None, None), track(Some("  "), None, None, None)];
        assert_eq!(album_agreement(&all_missing), AlbumVerdict::AllMissing);

        let partial = vec![track(Some("X"), None, None, None), track(None, None, None, None)];
        assert_eq!(
            album_agreement(&partial),
            AlbumVerdict::PartiallyMissing("X".to_string())
        );
    }

    #[test]
    fn id_agreement_untagged_does_not_veto() {
        let tracks = vec![
            track(None, None, Some("11111111-1111-1111-1111-111111111111"), None),
            track(None, None, None, None),
            track(None, None, Some("11111111-1111-1111-1111-111111111111"), None),
        ];
        assert_eq!(
            id_agreement(&tracks, |t| &t.mb_release_id),
            IdVerdict::Unanimous("11111111-1111-1111-1111-111111111111".to_string())
        );
    }

    #[test]
    fn id_agreement_case_and_garbage_wrapped_variants_agree() {
        let tracks = vec![
            track(None, None, Some("11111111-1111-1111-1111-111111111111"), None),
            track(None, None, Some("MusicBrainz/11111111-1111-1111-1111-111111111111;end"), None),
            track(None, None, Some("11111111-1111-1111-1111-111111111111".to_uppercase().as_str()), None),
        ];
        assert_eq!(
            id_agreement(&tracks, |t| &t.mb_release_id),
            IdVerdict::Unanimous("11111111-1111-1111-1111-111111111111".to_string())
        );
    }

    #[test]
    fn id_agreement_two_ids_disagree() {
        let tracks = vec![
            track(None, None, Some("11111111-1111-1111-1111-111111111111"), None),
            track(None, None, Some("22222222-2222-2222-2222-222222222222"), None),
        ];
        assert_eq!(id_agreement(&tracks, |t| &t.mb_release_id), IdVerdict::Divergent);
    }

    #[test]
    fn id_agreement_none_tagged_is_absent() {
        let tracks = vec![track(None, None, None, None)];
        assert_eq!(id_agreement(&tracks, |t| &t.mb_release_id), IdVerdict::Absent);
    }

    const REL_A: &str = "11111111-1111-1111-1111-111111111111";
    const REL_B: &str = "22222222-2222-2222-2222-222222222222";
    const RG_A: &str = "33333333-3333-3333-3333-333333333333";

    #[test]
    fn precedence_rg_unanimous_sub_case() {
        let tracks = vec![
            track(Some("X"), None, Some(REL_A), Some(RG_A)),
            track(Some("X"), None, Some(REL_B), Some(RG_A)),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, Some(MB_ALBUM_DIVERGENCE_RG_UNANIMOUS));
    }

    #[test]
    fn precedence_rg_divergent_sub_case() {
        let tracks = vec![
            track(Some("X"), None, Some(REL_A), Some(RG_A)),
            track(Some("X"), None, Some(REL_B), Some("44444444-4444-4444-4444-444444444444")),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, Some(MB_ALBUM_DIVERGENCE));
    }

    #[test]
    fn precedence_rg_only_divergence() {
        let tracks = vec![
            track(Some("X"), None, None, Some(RG_A)),
            track(Some("X"), None, None, Some("44444444-4444-4444-4444-444444444444")),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, Some(MB_RELEASE_GROUP_DIVERGENCE));
    }

    #[test]
    fn precedence_album_divergence_before_missing() {
        // One track "A", one track untagged, one track "B" -> divergence wins over missing.
        let tracks = vec![
            track(Some("A"), None, None, None),
            track(None, None, None, None),
            track(Some("B"), None, None, None),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, Some(ALBUM_DIVERGENCE));
    }

    #[test]
    fn precedence_clean_when_everything_agrees() {
        let tracks = vec![
            track(Some("X"), Some(2000), Some(REL_A), Some(RG_A)),
            track(Some("X"), Some(2000), Some(REL_A), Some(RG_A)),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, None);
        assert_eq!(v.title, Some("X".to_string()));
        assert_eq!(v.year, Some(2000));
        assert_eq!(v.mb_release_id, Some(REL_A.to_string()));
        assert_eq!(v.mb_release_group_id, Some(RG_A.to_string()));
    }

    #[test]
    fn year_agreement_disagree_is_none_but_not_a_trigger() {
        let tracks = vec![track(Some("X"), Some(1999), None, None), track(Some("X"), Some(2000), None, None)];
        assert_eq!(year_agreement(&tracks), None);
        let v = evaluate(&tracks);
        assert_eq!(v.reason, None);
        assert_eq!(v.year, None);
    }

    #[test]
    fn first_occurrence_original_casing_preserved() {
        let tracks = vec![
            track(Some("The Album"), None, None, None),
            track(Some("the album"), None, None, None),
        ];
        let v = evaluate(&tracks);
        assert_eq!(v.title, Some("The Album".to_string()));
    }

    #[test]
    fn folder_leaf_strips_parent_path() {
        assert_eq!(folder_leaf("Artist/Album/2011 - Jazz Heroes"), "2011 - Jazz Heroes");
        assert_eq!(folder_leaf("NoSlash"), "NoSlash");
    }

    #[test]
    fn single_track_folder_is_trivially_unanimous() {
        let tracks = vec![track(Some("Solo"), Some(2020), Some(REL_A), Some(RG_A))];
        let v = evaluate(&tracks);
        assert_eq!(v.reason, None);
        assert_eq!(v.title, Some("Solo".to_string()));
    }
}
