use chrono::{NaiveDateTime, Utc};
use common::filters::escape_like;
use common::mb::cache::cache_answer;
use common::mb::names::CacheAnswer;
use common::types::TrackMeta;
use slug::slugify;
use sqlx::PgPool;
use std::collections::HashMap;

pub fn strip_disc_subfolder(folder_path: &str) -> String {
    if let Some(last_slash) = folder_path.rfind('/') {
        let last_segment = &folder_path[last_slash + 1..];
        let lower = last_segment.to_lowercase();
        let is_disc_folder = if let Some(rest) = lower.strip_prefix("cd") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else if let Some(rest) = lower.strip_prefix("disc") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else if let Some(rest) = lower.strip_prefix("disk") {
            let rest = rest.trim_start();
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        } else {
            false
        };
        if is_disc_folder {
            return folder_path[..last_slash].to_string();
        }
    }
    folder_path.to_string()
}

/// Group tracks into one LocalRelease by their containing folder (the physical release unit).
/// The folder path is a structural boundary only - never parsed for metadata values (title/year/
/// artist come from tags, then from the MusicBrainz match). Per-track MB ids are deliberately NOT
/// part of the key: an MB release id identifies which release a *recording* appears on, not which
/// folder-album a *file* belongs to, so keying on it shreds compilations (whose files carry their
/// original sources' ids) into per-track fragments. Root-level files with no folder fall back to
/// album-identity tags.
pub fn build_group_key(
    album_title: &str,
    year: Option<i32>,
    album_artist: &str,
    folder_path: &str,
) -> String {
    if !folder_path.is_empty() {
        return format!("folder:{}", folder_path);
    }
    let title_slug = slugify(album_title);
    let artist_slug = if album_artist.is_empty() {
        "unknown".to_string()
    } else {
        slugify(album_artist)
    };
    format!("meta:{}:{}:{}", title_slug, year.unwrap_or(0), artist_slug)
}

pub fn image_key_for_release(
    mb_release_id: Option<&str>,
    mb_release_group_id: Option<&str>,
) -> Option<String> {
    mb_release_id
        .filter(|s| !s.is_empty())
        .or(mb_release_group_id.filter(|s| !s.is_empty()))
        .map(|s| s.to_string())
}

pub fn image_key_from_group_key(group_key: &str) -> Option<String> {
    if let Some(rest) = group_key
        .strip_prefix("mbr:")
        .or_else(|| group_key.strip_prefix("mb:"))
    {
        if let Some(id) = rest.split(':').next().filter(|s| !s.is_empty()) {
            return Some(id.to_string());
        }
    }
    None
}

/// What `ensure_local_release`/`ensure_local_release_cached` need to upsert one `LocalRelease` row -
/// bundled since every caller has all five at once (the folder loop's own consensus verdict).
pub struct ReleaseFacts<'a> {
    pub title: &'a str,
    pub year: Option<i32>,
    pub folder_path: &'a str,
    pub group_key: &'a str,
    pub status: &'a str,
    pub reason: Option<&'a str>,
}

pub async fn ensure_local_release(
    pool: &PgPool,
    facts: &ReleaseFacts<'_>,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "LocalRelease" (id, title, year, "matchStatus", "forcedComplete", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath", "groupKey", "statusReason")
           VALUES ($1, $2, $3, $7::"ReleaseStatus", false, 0, 0, $4, $4, $5, $6, $8)
           ON CONFLICT ("groupKey") DO UPDATE SET
             title = EXCLUDED.title,
             year = COALESCE(EXCLUDED.year, "LocalRelease".year),
             "folderPath" = EXCLUDED."folderPath",
             "updatedAt" = $4
           RETURNING id"#,
    )
    .bind(&id)
    .bind(facts.title)
    .bind(facts.year)
    .bind(now)
    .bind(facts.folder_path)
    .bind(facts.group_key)
    .bind(facts.status)
    .bind(facts.reason)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

pub async fn ensure_local_release_cached(
    pool: &PgPool,
    facts: &ReleaseFacts<'_>,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(facts.group_key) {
        return Ok(id.clone());
    }
    let id = ensure_local_release(pool, facts).await?;
    cache.insert(facts.group_key.to_string(), id.clone());
    Ok(id)
}

/// Per-folder consensus counts this run set, for the run summary.
#[derive(Debug, Default)]
pub struct ConsensusStats {
    pub reason_counts: HashMap<&'static str, u64>,
    pub cleared: u64,
}

/// Re-evaluate `touched_release_ids`' consensus verdict straight from the DB (not from `extracted`,
/// which only ever holds this run's new/changed files - see the call site's doc comment). A folder
/// whose tracks disagree is parked at UNKNOWN with a reason; one that now agrees (retagged) is
/// cleared back to UNMATCHED so sync picks it up. Box-placed / member releases are skipped: their
/// placement comes from the box pass, not from tags.
pub async fn apply_folder_consensus(
    pool: &PgPool,
    touched_release_ids: &[String],
) -> Result<ConsensusStats, sqlx::Error> {
    use common::consensus::{evaluate, mark_local_release_unknown, TrackTags};

    let mut stats = ConsensusStats::default();

    for release_id in touched_release_ids {
        let exempt: Option<(bool,)> = sqlx::query_as(
            r#"SELECT
                 lr."boxReleaseId" IS NOT NULL
                 OR lr."mediumPosition" IS NOT NULL
                 OR EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id)
               FROM "LocalRelease" lr WHERE lr.id = $1"#,
        )
        .bind(release_id)
        .fetch_optional(pool)
        .await?;

        let Some((exempt,)) = exempt else { continue };
        if exempt {
            continue;
        }

        #[derive(sqlx::FromRow)]
        struct ConsensusTrackRow {
            id: String,
            album: Option<String>,
            year: Option<i32>,
            #[sqlx(rename = "mbReleaseId")]
            mb_release_id: Option<String>,
            #[sqlx(rename = "mbReleaseGroupId")]
            mb_release_group_id: Option<String>,
            #[sqlx(rename = "discNumber")]
            disc_number: Option<i32>,
            #[sqlx(rename = "trackNumber")]
            track_number: Option<i32>,
            #[sqlx(rename = "filePath")]
            file_path: String,
        }

        let rows: Vec<ConsensusTrackRow> = sqlx::query_as(
            r#"SELECT id, album, year, "mbReleaseId", "mbReleaseGroupId", "discNumber", "trackNumber", "filePath"
               FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
        )
        .bind(release_id)
        .fetch_all(pool)
        .await?;

        if rows.is_empty() {
            continue;
        }

        let tracks: Vec<TrackTags> = rows
            .into_iter()
            .map(|r| TrackTags {
                id: r.id,
                album: r.album,
                year: r.year,
                mb_release_id: r.mb_release_id,
                mb_release_group_id: r.mb_release_group_id,
                disc_number: r.disc_number,
                track_number: r.track_number,
                file_path: Some(r.file_path),
            })
            .collect();

        let verdict = evaluate(&tracks);

        if let Some(reason) = verdict.reason {
            mark_local_release_unknown(pool, release_id, reason).await?;
            if verdict.year.is_some() {
                sqlx::query(
                    r#"UPDATE "LocalRelease" SET year = $2, "updatedAt" = NOW() WHERE id = $1"#,
                )
                .bind(release_id)
                .bind(verdict.year)
                .execute(pool)
                .await
                .ok();
            }
            *stats.reason_counts.entry(reason).or_insert(0) += 1;
            continue;
        }

        let already_had_reason: Option<(bool,)> = sqlx::query_as(
            r#"SELECT "statusReason" IS NOT NULL FROM "LocalRelease" WHERE id = $1"#,
        )
        .bind(release_id)
        .fetch_optional(pool)
        .await?;

        sqlx::query(
            r#"UPDATE "LocalRelease" SET title = COALESCE($2, title), year = $3, "updatedAt" = NOW() WHERE id = $1"#,
        )
        .bind(release_id)
        .bind(verdict.title.as_deref())
        .bind(verdict.year)
        .execute(pool)
        .await
        .ok();

        if already_had_reason.map(|(v,)| v).unwrap_or(false) {
            sqlx::query(
                r#"UPDATE "LocalRelease" SET "matchStatus" = 'UNMATCHED'::"ReleaseStatus", "statusReason" = NULL, "updatedAt" = NOW() WHERE id = $1"#,
            )
            .bind(release_id)
            .execute(pool)
            .await
            .ok();
            stats.cleared += 1;
        }
    }

    Ok(stats)
}

/// Every folder `sync` has already folded (plain multi-disc) or dissolved (box set) into a
/// `LocalRelease`, keyed by folder path. Index never folds on its own (docs/sync_decisions.md) - it
/// only knows tags, and the fold-vs-dissolve decision needs MB medium data. So a folder found here
/// must be routed straight to its existing release, never through
/// `build_group_key`/`ensure_local_release_cached`. Without this, a folded/dissolved folder's
/// title/year would be rewritten from that disc's own tags and, worse, its folderPath's `groupKey`
/// regenerated fresh on the very next full re-index that touches it - splitting it straight back
/// apart. One query, small table, fetched once per index run.
pub async fn get_local_release_members(
    pool: &PgPool,
) -> Result<HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "folderPath", "localReleaseId" FROM "LocalReleaseMember""#)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Batch upsert tracks. Returns map of filePath → track id.
pub async fn batch_upsert_tracks(
    pool: &PgPool,
    tracks: &[(&TrackMeta, String)],
) -> Result<HashMap<String, String>, sqlx::Error> {
    if tracks.is_empty() {
        return Ok(HashMap::new());
    }

    let len = tracks.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut titles: Vec<Option<String>> = Vec::with_capacity(len);
    let mut artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut album_artists: Vec<Option<String>> = Vec::with_capacity(len);
    let mut albums: Vec<Option<String>> = Vec::with_capacity(len);
    let mut years: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut genres: Vec<Option<String>> = Vec::with_capacity(len);
    let mut durations: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut bitrates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut sample_rates: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut file_paths: Vec<String> = Vec::with_capacity(len);
    let mut positions: Vec<Option<String>> = Vec::with_capacity(len);
    let mut track_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut disc_numbers: Vec<Option<i32>> = Vec::with_capacity(len);
    let mut release_ids: Vec<String> = Vec::with_capacity(len);
    let mut file_sizes: Vec<i64> = Vec::with_capacity(len);
    let mut mtimes: Vec<NaiveDateTime> = Vec::with_capacity(len);
    let mut content_hashes: Vec<String> = Vec::with_capacity(len);
    let mut metadatas: Vec<serde_json::Value> = Vec::with_capacity(len);
    let mut mb_release_group_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let mut mb_release_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let mut mb_album_artist_ids: Vec<Option<String>> = Vec::with_capacity(len);
    // Per-row string arrays can't ride along in UNNEST (no array-of-array columns), so they travel as
    // jsonb and are converted back to text[] per row in the SELECT below.
    let mut artists_multi: Vec<serde_json::Value> = Vec::with_capacity(len);
    let mut mb_artist_ids_multi: Vec<serde_json::Value> = Vec::with_capacity(len);
    let mut album_artists_multi: Vec<serde_json::Value> = Vec::with_capacity(len);
    let mut mb_album_artist_ids_multi: Vec<serde_json::Value> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();

    for (track, release_id) in tracks {
        ids.push(cuid2::create_id());
        titles.push(track.title.clone());
        artists.push(track.artist.clone());
        album_artists.push(track.album_artist.clone());
        albums.push(track.album.clone());
        years.push(track.year);
        genres.push(track.genre.clone());
        durations.push(track.duration);
        bitrates.push(track.bitrate);
        sample_rates.push(track.sample_rate);
        file_paths.push(track.file_path.clone());
        positions.push(track.position.clone());
        track_numbers.push(track.track_number);
        disc_numbers.push(track.disc_number);
        release_ids.push(release_id.clone());
        file_sizes.push(track.file_size);
        mtimes.push(track.mtime);
        content_hashes.push(track.content_hash.clone());
        metadatas
            .push(serde_json::to_value(&track.metadata_json).unwrap_or(serde_json::Value::Null));
        mb_release_group_ids.push(track.mb_release_group_id.clone());
        mb_release_ids.push(track.mb_release_id.clone());
        mb_album_artist_ids.push(track.mb_album_artist_id.clone());
        artists_multi.push(serde_json::json!(track.artists));
        mb_artist_ids_multi.push(serde_json::json!(track.mb_artist_ids));
        album_artists_multi.push(serde_json::json!(track.album_artists));
        mb_album_artist_ids_multi.push(serde_json::json!(track.mb_album_artist_ids));
    }

    let created: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "createdAt", "updatedAt", "mbReleaseGroupId", "mbReleaseId", "mbAlbumArtistId",
            artists, "mbArtistIds", "albumArtists", "mbAlbumArtistIds")
           SELECT t.id, t.title, t.artist, t.album_artist, t.album, t.year, t.genre,
                  t.duration, t.bitrate, t.sample_rate, t.file_path, t.position, t.track_number, t.disc_number,
                  t.release_id, t.file_size, t.mtime, t.content_hash, t.metadata,
                  t.created, t.updated, t.mb_rg_id, t.mb_rel_id, t.mb_aa_id,
                  ARRAY(SELECT jsonb_array_elements_text(t.artists_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.mb_artist_ids_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.album_artists_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.mb_album_artist_ids_json))
           FROM UNNEST(
               $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
               $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::int[], $14::int[],
               $15::text[], $16::bigint[], $17::timestamp[], $18::text[], $19::jsonb[],
               $20::timestamp[], $21::timestamp[], $22::text[], $23::text[], $24::text[],
               $25::jsonb[], $26::jsonb[], $27::jsonb[], $28::jsonb[]
           ) AS t(id, title, artist, album_artist, album, year, genre,
                  duration, bitrate, sample_rate, file_path, position, track_number, disc_number,
                  release_id, file_size, mtime, content_hash, metadata,
                  created, updated, mb_rg_id, mb_rel_id, mb_aa_id,
                  artists_json, mb_artist_ids_json, album_artists_json, mb_album_artist_ids_json)
           ON CONFLICT ("filePath") DO UPDATE SET
             title = EXCLUDED.title, artist = EXCLUDED.artist, "albumArtist" = EXCLUDED."albumArtist",
             album = EXCLUDED.album, year = EXCLUDED.year, genre = EXCLUDED.genre,
             duration = EXCLUDED.duration, bitrate = EXCLUDED.bitrate, "sampleRate" = EXCLUDED."sampleRate",
             position = EXCLUDED.position, "trackNumber" = EXCLUDED."trackNumber", "discNumber" = EXCLUDED."discNumber",
             "localReleaseId" = EXCLUDED."localReleaseId", "fileSize" = EXCLUDED."fileSize",
             mtime = EXCLUDED.mtime, "contentHash" = EXCLUDED."contentHash", metadata = EXCLUDED.metadata,
             "mbReleaseGroupId" = EXCLUDED."mbReleaseGroupId", "mbReleaseId" = EXCLUDED."mbReleaseId",
             "mbAlbumArtistId" = EXCLUDED."mbAlbumArtistId",
             artists = EXCLUDED.artists, "mbArtistIds" = EXCLUDED."mbArtistIds",
             "albumArtists" = EXCLUDED."albumArtists", "mbAlbumArtistIds" = EXCLUDED."mbAlbumArtistIds",
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id, "filePath""#,
    )
    .bind(&ids)
    .bind(&titles)
    .bind(&artists)
    .bind(&album_artists)
    .bind(&albums)
    .bind(&years)
    .bind(&genres)
    .bind(&durations)
    .bind(&bitrates)
    .bind(&sample_rates)
    .bind(&file_paths)
    .bind(&positions)
    .bind(&track_numbers)
    .bind(&disc_numbers)
    .bind(&release_ids)
    .bind(&file_sizes)
    .bind(&mtimes)
    .bind(&content_hashes)
    .bind(&metadatas)
    .bind(&created)
    .bind(&created)
    .bind(&mb_release_group_ids)
    .bind(&mb_release_ids)
    .bind(&mb_album_artist_ids)
    .bind(&artists_multi)
    .bind(&mb_artist_ids_multi)
    .bind(&album_artists_multi)
    .bind(&mb_album_artist_ids_multi)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, path)| (path, id)).collect())
}

pub async fn batch_ensure_track_related_artists(
    executor: impl sqlx::PgExecutor<'_>,
    links: &[(String, String)],
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }

    let len = links.len();
    let mut ids: Vec<String> = Vec::with_capacity(len);
    let mut track_ids: Vec<String> = Vec::with_capacity(len);
    let mut artist_ids: Vec<String> = Vec::with_capacity(len);
    let now = Utc::now().naive_utc();
    let mut timestamps: Vec<NaiveDateTime> = Vec::with_capacity(len);

    for (tid, aid) in links {
        ids.push(cuid2::create_id());
        track_ids.push(tid.clone());
        artist_ids.push(aid.clone());
        timestamps.push(now);
    }

    sqlx::query(
        r#"INSERT INTO "TrackRelatedArtist" (id, "trackId", "artistId", "createdAt")
           SELECT id, "trackId", "artistId", "createdAt"
           FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamp[])
             AS t(id, "trackId", "artistId", "createdAt")
           ON CONFLICT ("trackId", "artistId") DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&track_ids)
    .bind(&artist_ids)
    .bind(&timestamps)
    .execute(executor)
    .await?;

    Ok(())
}

pub async fn batch_ensure_local_release_artists(
    pool: &PgPool,
    links: &[(String, String)],
) -> Result<(), sqlx::Error> {
    if links.is_empty() {
        return Ok(());
    }
    let now = Utc::now().naive_utc();
    let ids: Vec<String> = links.iter().map(|_| cuid2::create_id()).collect();
    let release_ids: Vec<String> = links.iter().map(|(r, _)| r.clone()).collect();
    let artist_ids: Vec<String> = links.iter().map(|(_, a)| a.clone()).collect();
    let timestamps: Vec<NaiveDateTime> = vec![now; links.len()];
    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamp[])
           ON CONFLICT ("localReleaseId", "artistId") DO NOTHING"#,
    )
    .bind(&ids)
    .bind(&release_ids)
    .bind(&artist_ids)
    .bind(&timestamps)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn batch_update_mtimes(
    pool: &PgPool,
    updates: &[(NaiveDateTime, String)],
) -> Result<(), sqlx::Error> {
    if updates.is_empty() {
        return Ok(());
    }
    let mtimes: Vec<NaiveDateTime> = updates.iter().map(|(m, _)| *m).collect();
    let paths: Vec<String> = updates.iter().map(|(_, p)| p.clone()).collect();
    let now = Utc::now().naive_utc();
    sqlx::query(
        r#"UPDATE "LocalReleaseTrack" SET mtime = u.mtime, "updatedAt" = $3
           FROM UNNEST($1::timestamp[], $2::text[]) AS u(mtime, path)
           WHERE "LocalReleaseTrack"."filePath" = u.path"#,
    )
    .bind(&mtimes)
    .bind(&paths)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Update lastIndexedAt on Artist rows after indexing a folder.
pub async fn update_last_indexed_at(
    pool: &PgPool,
    artist_ids: &[String],
) -> Result<(), sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"UPDATE "Artist" SET "lastIndexedAt" = NOW(), "updatedAt" = NOW()
           WHERE id = ANY($1::text[])"#,
    )
    .bind(artist_ids)
    .execute(pool)
    .await?;
    Ok(())
}

/// Per-artist track-link count under an artist-root folder (prefix, trailing `/`): +1 for every track
/// they own the release of (`LocalReleaseArtist`) or are credited on (`TrackRelatedArtist`). Used to
/// pick the one artist a folder's cover art actually belongs to - never propagated to co-owners/guests.
pub async fn folder_artist_track_counts(pool: &PgPool, folder_prefix: &str) -> Vec<(String, i64)> {
    sqlx::query_as(
        r#"
        WITH tr AS (
            SELECT t.id AS tid, t."localReleaseId" AS rid
            FROM "LocalReleaseTrack" t
            JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
            WHERE lr."folderPath" LIKE $1
        )
        SELECT a, count(*) FROM (
            SELECT lra."artistId" AS a, tr.tid FROM tr JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = tr.rid
            UNION
            SELECT tra."artistId" AS a, tr.tid FROM tr JOIN "TrackRelatedArtist" tra ON tra."trackId" = tr.tid
        ) x
        GROUP BY a
        "#,
    )
    .bind(format!("{}%", escape_like(folder_prefix)))
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

/// The strict-majority artist id from `folder_artist_track_counts`, or `None` on a tie/empty result -
/// a folder's cover art is only ever attributed to one clear main artist, never split or guessed.
pub fn pick_folder_image_owner(counts: &[(String, i64)]) -> Option<String> {
    let mut sorted = counts.to_vec();
    sorted.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    match sorted.as_slice() {
        [(id, top), rest @ ..] if rest.first().map(|(_, c)| c < top).unwrap_or(true) => {
            Some(id.clone())
        }
        _ => None,
    }
}

#[cfg(test)]
mod folder_image_owner_tests {
    use super::pick_folder_image_owner;

    #[test]
    fn clear_winner() {
        let counts = vec![
            ("main".to_string(), 24),
            ("guest-a".to_string(), 1),
            ("guest-b".to_string(), 1),
        ];
        assert_eq!(pick_folder_image_owner(&counts), Some("main".to_string()));
    }

    #[test]
    fn tie_is_none() {
        let counts = vec![("a".to_string(), 15), ("b".to_string(), 15)];
        assert_eq!(pick_folder_image_owner(&counts), None);
    }

    #[test]
    fn empty_is_none() {
        assert_eq!(pick_folder_image_owner(&[]), None);
    }

    #[test]
    fn single_artist_wins() {
        let counts = vec![("solo".to_string(), 8)];
        assert_eq!(pick_folder_image_owner(&counts), Some("solo".to_string()));
    }
}

// ---------------------------------------------------------------------------
// FolderScan helpers
// ---------------------------------------------------------------------------

/// Upsert a folder's mtime into the FolderScan cache table.
pub async fn upsert_folder_scan(
    pool: &PgPool,
    folder_path: &str,
    mtime: NaiveDateTime,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "FolderScan" ("folderPath", mtime) VALUES ($1, $2)
           ON CONFLICT ("folderPath") DO UPDATE SET mtime = EXCLUDED.mtime"#,
    )
    .bind(folder_path)
    .bind(mtime)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn propagate_mb_artist_id(pool: &PgPool, artist_id: &str) -> Result<(), sqlx::Error> {
    let existing: Option<(Option<String>, String)> =
        sqlx::query_as(r#"SELECT "musicbrainzId", name FROM "Artist" WHERE id = $1"#)
            .bind(artist_id)
            .fetch_optional(pool)
            .await?;

    let Some((existing_mbid, artist_name)) = existing else {
        return Ok(());
    };

    if let Some(ref mb_id) = existing_mbid {
        if !mb_id.is_empty() {
            return Ok(());
        }
    }

    // Only trust the embedded mbAlbumArtistId from releases where this artist is the SOLE main
    // credited artist. A collab release ("A & B") links both A and B via LocalReleaseArtist to the
    // same tracks, but the tag holds only the primary album artist's MB id - crediting that id to a
    // co-artist with no other releases is exactly how a guest ends up impersonating the headliner in
    // MusicBrainz terms (root feeder of the shared-releaseId + false-duplicate-artist bugs).
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lrt."mbAlbumArtistId"
           FROM "LocalReleaseTrack" lrt
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
           WHERE lra."artistId" = $1
             AND lrt."mbAlbumArtistId" IS NOT NULL
             AND lrt."mbAlbumArtistId" != ''
             AND (
               SELECT COUNT(*) FROM "LocalReleaseArtist" lra2
               WHERE lra2."localReleaseId" = lrt."localReleaseId"
             ) = 1"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;

    if rows.len() == 1 {
        let candidate_mbid = &rows[0].0;
        // The row's own name is the only thing this candidate can be checked against here (no MB
        // candidate/alias payload available offline) - reject only on an explicit cache contradiction,
        // same rule as identity_verdict: a Hit for a DIFFERENT id outweighs the embedded tag, but an
        // absent or definite-miss cache entry is not evidence against it. See docs/sync_decisions.md §4-6.
        let contradicted = matches!(
            cache_answer(pool, &artist_name).await,
            CacheAnswer::Hit(known) if known != *candidate_mbid
        );
        if !contradicted {
            sqlx::query(
                r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
                   WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
            )
            .bind(candidate_mbid)
            .bind(artist_id)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Run-hash resumability
// ---------------------------------------------------------------------------

pub async fn load_indexed_folders(pool: &PgPool, hash: &str) -> std::collections::HashSet<String> {
    let rows: Vec<(String,)> =
        sqlx::query_as(r#"SELECT "folderPath" FROM "FolderScan" WHERE "indexHash" = $1"#)
            .bind(hash)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    rows.into_iter().map(|(p,)| p).collect()
}

pub async fn stamp_folder_index_hash(pool: &PgPool, folder_path: &str, hash: &str) {
    sqlx::query(
        r#"INSERT INTO "FolderScan" ("folderPath", mtime, "indexHash")
           VALUES ($1, NOW(), $2)
           ON CONFLICT ("folderPath") DO UPDATE SET "indexHash" = $2"#,
    )
    .bind(folder_path)
    .bind(hash)
    .execute(pool)
    .await
    .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_key_is_folder_scoped_regardless_of_tags() {
        // Two tracks in the same folder with different album tags / years still key to one release.
        let a = build_group_key(
            "Portrait",
            Some(1986),
            "Teddy Wilson",
            "Teddy Wilson/Album/2011 - Jazz Heroes",
        );
        let b = build_group_key(
            "Different Album",
            Some(1999),
            "Teddy Wilson",
            "Teddy Wilson/Album/2011 - Jazz Heroes",
        );
        assert_eq!(a, b);
        assert_eq!(a, "folder:Teddy Wilson/Album/2011 - Jazz Heroes");
    }

    #[test]
    fn group_key_distinguishes_different_folders() {
        let a = build_group_key(
            "Guitar Town",
            Some(1986),
            "Steve Earle",
            "Steve Earle/Album/1986 - Guitar Town",
        );
        let b = build_group_key(
            "Guitar Town",
            Some(1986),
            "Steve Earle",
            "Steve Earle/Remastered/1986 - Guitar Town [2002]",
        );
        assert_ne!(a, b);
    }

    #[test]
    fn group_key_falls_back_to_meta_when_no_folder() {
        let k = build_group_key("Some Album", Some(1990), "Some Artist", "");
        assert_eq!(k, "meta:some-album:1990:some-artist");
    }

    #[test]
    fn strip_disc_subfolder_collapses_disc_dirs() {
        assert_eq!(strip_disc_subfolder("Artist/Album/CD1"), "Artist/Album");
        assert_eq!(strip_disc_subfolder("Artist/Album/Disc 2"), "Artist/Album");
        assert_eq!(strip_disc_subfolder("Artist/Album"), "Artist/Album");
        // Non-pure-digit suffix is NOT a disc folder (known box-set gap, left as-is).
        assert_eq!(
            strip_disc_subfolder("Artist/Box/CD2 - Warmin' Up"),
            "Artist/Box/CD2 - Warmin' Up"
        );
    }
}
