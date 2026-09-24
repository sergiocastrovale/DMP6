use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

/// Sweep `primaryArtistId` links that should never have been made, in one pass.
///
/// Two artist rows are the same artist only when **both names resolve to the same MusicBrainz id**
/// (CLAUDE.md's rule for this column). The 33 links found in this library all break it, in three
/// different ways, and they need three different answers - "the row that owns the releases wins" is
/// not one of them:
///
///   * Same id on both sides - a genuine alias ("Grover Washington, Jr." / "Grover Washington").
///     Promote the row that owns the releases.
///   * Different ids, or either side unresolved - not the same artist at all. "Faith" was filed under
///     "Percy Faith", "Forest" under "Deep Forest", and collaboration names like "Indica Dubs meets
///     Vibronics" under "Indica Dubs". Swapping these would only invert the error and make the
///     collaboration outrank the real artist, so the link is removed and both stand on their own.
///   * A primary whose stored id contradicts its own name ("Wardell Gray Quintet" holding Erroll
///     Garner's id) also gives that id up - it is what dragged the releases across in the first place.
///
/// Pure SQL, no MusicBrainz calls. Returns one row per repair for reporting.
pub struct IdentityRepair {
    pub artist: String,
    pub releases: i64,
    pub other: String,
    pub action: &'static str,
}

pub async fn repair_all_empty_primaries(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<IdentityRepair>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct EmptyPrimaryPairRow {
        dup_id: String,
        dup_name: String,
        n_local: i64,
        empty_id: String,
        empty_name: String,
        dup_mbid: Option<String>,
        empty_mbid: Option<String>,
        #[sqlx(rename = "musicbrainzId")]
        empty_stored_mbid: Option<String>,
    }

    let pairs: Vec<EmptyPrimaryPairRow> = sqlx::query_as(
        r#"SELECT d.id AS dup_id, d.name AS dup_name,
                  (SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId" = d.id) AS n_local,
                  p.id AS empty_id, p.name AS empty_name,
                  (SELECT l.mbid FROM "MbArtistLookup" l WHERE l.name = d.name AND l.mbid IS NOT NULL LIMIT 1) AS dup_mbid,
                  (SELECT l.mbid FROM "MbArtistLookup" l WHERE l.name = p.name AND l.mbid IS NOT NULL LIMIT 1) AS empty_mbid,
                  p."musicbrainzId"
           FROM "Artist" d
           JOIN "Artist" p ON p.id = d."primaryArtistId"
           WHERE EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = d.id)
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = p.id)
           ORDER BY 3 DESC"#,
    )
    .fetch_all(pool)
    .await?;

    let mut done = Vec::new();
    for EmptyPrimaryPairRow {
        dup_id,
        dup_name,
        n_local,
        empty_id,
        empty_name,
        dup_mbid,
        empty_mbid,
        empty_stored_mbid,
    } in pairs
    {
        let same_artist = match (dup_mbid.as_deref(), empty_mbid.as_deref()) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        };

        let action = if same_artist {
            if !dry_run {
                promote_over_empty_primary(pool, &dup_id).await?;
            }
            "promoted over an alias of itself"
        } else {
            if !dry_run {
                sqlx::query(
                    r#"UPDATE "Artist" SET "primaryArtistId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
                )
                .bind(&dup_id)
                .execute(pool)
                .await?;
                // A stored id that contradicts the row's own name is what moved the releases across.
                if let (Some(stored), Some(resolved)) =
                    (empty_stored_mbid.as_deref(), empty_mbid.as_deref())
                {
                    if stored != resolved {
                        sqlx::query(
                            r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
                        )
                        .bind(&empty_id)
                        .execute(pool)
                        .await?;
                    }
                }
            }
            "unlinked - not the same artist"
        };

        done.push(IdentityRepair {
            artist: dup_name,
            releases: n_local,
            other: empty_name,
            action,
        });
    }
    Ok(done)
}

/// Repair a `primaryArtistId` that points at an artist owning nothing.
///
/// Duplicate detection must never accept just *any* other row holding the same MusicBrainz id as the
/// primary with no check that it owns anything: with no ordering and no ownership check, whichever
/// row a sync happens to reach first wins, so a stray credit-only row can end up canonical over the
/// row holding the entire discography. The artist page then renders under the wrong name and the
/// real row is unreachable.
///
/// Callers reach here only once the current artist is known to own local releases, so "primary owns
/// nothing" is unambiguous: swap the two. The empty row becomes the duplicate, which also makes it
/// eligible for `cleanup_empty_connected_artists` to remove entirely.
///
/// Returns the demoted artist's name when a swap happened, for reporting.
pub async fn promote_over_empty_primary(
    pool: &PgPool,
    artist_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let demoted: Option<(String, String)> = sqlx::query_as(
        r#"SELECT p.id, p.name
           FROM "Artist" a
           JOIN "Artist" p ON p.id = a."primaryArtistId"
           WHERE a.id = $1
             AND NOT EXISTS (
               SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = p.id
             )"#,
    )
    .bind(artist_id)
    .fetch_optional(pool)
    .await?;

    let Some((empty_id, empty_name)) = demoted else {
        return Ok(None);
    };

    // Order matters: clear the current row first, or the second statement would point the empty row
    // at an artist that is still itself marked a duplicate, making a two-row cycle.
    sqlx::query(
        r#"UPDATE "Artist" SET "primaryArtistId" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    // The demoted row also gives up its MusicBrainz id, because that claim is what caused the
    // mis-filing in the first place. "Wardell Gray Quintet" (0 releases) was holding Erroll Garner's
    // MusicBrainz id - not its own, which is a different id entirely - so Erroll Garner's 76 releases
    // resolved onto it and filed themselves under that name. Leaving the id on the demoted row lets
    // two rows claim one artist, and the next sync can re-link them the same way round again.
    sqlx::query(
        r#"UPDATE "Artist"
           SET "primaryArtistId" = $1, "musicbrainzId" = NULL, "updatedAt" = NOW()
           WHERE id = $2 AND id <> $1"#,
    )
    .bind(artist_id)
    .bind(&empty_id)
    .execute(pool)
    .await?;

    Ok(Some(empty_name))
}

/// One artist whose stored id `MbArtistLookup` independently contradicts, for the dry-run report.
#[derive(Debug, Clone)]
pub struct ContradictedIdentity {
    pub artist: String,
    pub releases: i64,
    pub cleared_mbid: String,
}

/// Pass B of `--repair-artist-identities`: null a stored id the lookup table confidently disagrees
/// with, anywhere in the library - not just the `primaryArtistId`-linked pairs Pass A
/// (`repair_all_empty_primaries`) handles.
///
/// "Confidently disagrees" means `MbArtistLookup` has a row for this artist's exact name with a
/// **different, non-null** id. A row with no cached answer, or a cached miss (`mbid IS NULL`), is
/// left alone: neither is evidence against the stored id, only the absence of evidence for it - see
/// `common::mb::names::IdentityVerdict`.
/// Same "no wild guesses" rule as the ladder gate: withhold, never invent.
///
/// Also deletes the artist's derived `MusicBrainzReleaseArtist` rows, so the wrong discography stops
/// rendering immediately rather than lingering until the next sync. Must ship after the ladder gate
/// (§5) or the next un-gated sync re-mints the same id right back - see §6.
pub async fn repair_contradicted_identities(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<ContradictedIdentity>, sqlx::Error> {
    let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
        r#"SELECT a.id, a.name,
                  (SELECT count(*) FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id),
                  a."musicbrainzId"
           FROM "Artist" a
           JOIN "MbArtistLookup" l ON l.name = a.name
           WHERE l.mbid IS NOT NULL
             AND l.mbid <> a."musicbrainzId"
             AND a."musicbrainzId" IS NOT NULL
             AND a."musicbrainzId" <> ''
           ORDER BY a.name"#,
    )
    .fetch_all(pool)
    .await?;

    let mut done = Vec::with_capacity(rows.len());
    for (id, name, n_local, old_mbid) in rows {
        if !dry_run {
            sqlx::query(
                r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "lastSyncedAt" = NULL, "updatedAt" = NOW()
                   WHERE id = $1"#,
            )
            .bind(&id)
            .execute(pool)
            .await?;
            sqlx::query(r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#)
                .bind(&id)
                .execute(pool)
                .await?;
        }
        done.push(ContradictedIdentity {
            artist: name,
            releases: n_local,
            cleared_mbid: old_mbid,
        });
    }
    Ok(done)
}

/// One shared-id group `--repair-artist-identities` Pass C resolved (or left alone), for the report.
#[derive(Debug, Clone)]
pub struct SharedIdentityGroup {
    pub mbid: String,
    pub kept: Option<String>,
    pub cleared: Vec<String>,
}

/// Pass C of `--repair-artist-identities`: two or more *unrelated* Artist rows (no `primaryArtistId`
/// link between them - Pass A already owns that legitimate-alias case) holding the exact same
/// MusicBrainz id. One artist cannot correctly be two different names at once, so at most one member
/// of the group keeps the id.
///
/// "No wild guesses": the id is kept only where exactly one member's own name is confirmed by
/// `MbArtistLookup` for that exact id. If more than one member is confirmed, this is a genuine
/// ambiguity this pass cannot resolve safely and the group is left untouched for a human to look at.
/// If none is confirmed, every member gives the id up - an unconfirmed guess is exactly what created
/// the shared-id bug in the first place, and this pass exists to stop repeating it, not to make a
/// better-informed version of the same mistake.
pub async fn repair_shared_identities(
    pool: &PgPool,
    dry_run: bool,
) -> Result<Vec<SharedIdentityGroup>, sqlx::Error> {
    let mbids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "musicbrainzId" FROM "Artist"
           WHERE "musicbrainzId" IS NOT NULL AND "musicbrainzId" <> ''
             AND "primaryArtistId" IS NULL
           GROUP BY "musicbrainzId"
           HAVING count(*) > 1"#,
    )
    .fetch_all(pool)
    .await?;

    let mut done = Vec::with_capacity(mbids.len());
    for (mbid,) in mbids {
        let members: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT id, name FROM "Artist"
               WHERE "musicbrainzId" = $1 AND "primaryArtistId" IS NULL"#,
        )
        .bind(&mbid)
        .fetch_all(pool)
        .await?;

        let mut confirmed: Vec<(String, String)> = Vec::new();
        for (id, name) in &members {
            let hit: Option<(String,)> = sqlx::query_as(
                r#"SELECT mbid FROM "MbArtistLookup" WHERE name = $1 AND mbid = $2"#,
            )
            .bind(name)
            .bind(&mbid)
            .fetch_optional(pool)
            .await?;
            if hit.is_some() {
                confirmed.push((id.clone(), name.clone()));
            }
        }

        if confirmed.len() > 1 {
            continue;
        }
        let kept_id = confirmed.first().map(|(id, _)| id.clone());
        let kept_name = confirmed.first().map(|(_, name)| name.clone());

        let mut cleared = Vec::new();
        for (id, name) in &members {
            if kept_id.as_deref() == Some(id.as_str()) {
                continue;
            }
            cleared.push(name.clone());
            if !dry_run {
                sqlx::query(
                    r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "lastSyncedAt" = NULL, "updatedAt" = NOW()
                       WHERE id = $1"#,
                )
                .bind(id)
                .execute(pool)
                .await?;
                sqlx::query(r#"DELETE FROM "MusicBrainzReleaseArtist" WHERE "artistId" = $1"#)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
        }
        done.push(SharedIdentityGroup {
            mbid,
            kept: kept_name,
            cleared,
        });
    }
    Ok(done)
}

/// Release group -> containment note, for this artist's existing MISSING gaps.
///
/// Snapshotted before the gap pass wipes and rewrites those rows. Re-applying a note costs nothing;
/// re-deriving it costs one MusicBrainz call per group, so an ordinary sync carries the note forward
/// and only `--overwrite` pays to re-check it.
pub async fn get_contained_notes_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> HashMap<String, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId", mbr."statusReason"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mbr.id
           WHERE mra."artistId" = $1
             AND mbr.status = 'MISSING'
             AND mbr."releaseGroupId" IS NOT NULL
             AND mbr."statusReason" IS NOT NULL"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().collect()
}

/// Every local release of this artist with its track ids + titles — the candidate containers for
/// `owned::detect_containment`. One query per artist; only pulled when there are gaps to test.
pub async fn get_local_bundles_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Vec<crate::owned::LocalBundle> {
    let rows: Vec<(String, String, String, String, Option<i32>)> = sqlx::query_as(
        r#"SELECT lr.id, lr.title, lrt.id, COALESCE(lrt.title, ''), lrt.duration
           FROM "LocalRelease" lr
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           JOIN "Artist" a ON a.id = lra."artistId"
           JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
           WHERE (lra."artistId" = $1 OR a."primaryArtistId" = $1)
           ORDER BY lr.id, lrt."discNumber" NULLS FIRST, lrt."trackNumber" NULLS FIRST"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut bundles: Vec<crate::owned::LocalBundle> = Vec::new();
    for (release_id, release_title, track_id, track_title, duration) in rows {
        match bundles.last_mut() {
            Some(last) if last.release_id == release_id => {
                last.tracks.push((track_id, track_title, duration))
            }
            _ => bundles.push(crate::owned::LocalBundle {
                release_id,
                title: release_title,
                tracks: vec![(track_id, track_title, duration)],
            }),
        }
    }
    bundles
}

pub async fn get_missing_release_group_ids_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mbr.id
           WHERE mra."artistId" = $1
             AND mbr.status = 'MISSING'
             AND mbr."releaseGroupId" IS NOT NULL"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}
