use chrono::{NaiveDateTime, Utc};
use common::artists::split_artists;
use common::slug::make_slug;
use common::types::TrackMeta;
use slug::slugify;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

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
pub fn build_group_key(album_title: &str, year: Option<i32>, album_artist: &str, folder_path: &str) -> String {
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

/// Display title/year for a folder-release: the most common (mode) non-empty album tag and the most
/// common year among the folder's tracks, computed from a fixed insertion order so the same input
/// always yields the same result. Falls back to "Unknown Album" / None when the folder has no usable
/// album/year tags. Sync overrides these with the MusicBrainz match when one is found; this is the
/// pre-match, tag-derived display value.
pub fn folder_majority_title_year(tracks: &[(Option<String>, Option<i32>)]) -> (String, Option<i32>) {
    let mut album_counts: Vec<(String, usize)> = Vec::new();
    let mut year_counts: Vec<(i32, usize)> = Vec::new();
    for (album, year) in tracks {
        if let Some(a) = album.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            match album_counts.iter_mut().find(|(v, _)| v == a) {
                Some(entry) => entry.1 += 1,
                None => album_counts.push((a.to_string(), 1)),
            }
        }
        if let Some(y) = year {
            match year_counts.iter_mut().find(|(v, _)| v == y) {
                Some(entry) => entry.1 += 1,
                None => year_counts.push((*y, 1)),
            }
        }
    }
    let title = album_counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(v, _)| v)
        .unwrap_or_else(|| "Unknown Album".to_string());
    let year = year_counts.into_iter().max_by_key(|(_, c)| *c).map(|(v, _)| v);
    (title, year)
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

pub async fn ensure_local_release(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    folder_path: &str,
    group_key: &str,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let now = Utc::now().naive_utc();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "LocalRelease" (id, title, year, "matchStatus", "forcedComplete", "totalPlayCount", "totalDuration", "totalFileSize", "createdAt", "updatedAt", "folderPath", "groupKey")
           VALUES ($1, $2, $3, 'UNMATCHED', false, 0, 0, 0, $4, $4, $5, $6)
           ON CONFLICT ("groupKey") DO UPDATE SET
             title = EXCLUDED.title,
             year = COALESCE(EXCLUDED.year, "LocalRelease".year),
             "folderPath" = EXCLUDED."folderPath",
             "updatedAt" = $4
           RETURNING id"#,
    )
    .bind(&id)
    .bind(title)
    .bind(year)
    .bind(now)
    .bind(folder_path)
    .bind(group_key)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

pub async fn ensure_local_release_cached(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    folder_path: &str,
    group_key: &str,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(group_key) {
        return Ok(id.clone());
    }
    let id = ensure_local_release(pool, title, year, folder_path, group_key).await?;
    cache.insert(group_key.to_string(), id.clone());
    Ok(id)
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
        metadatas.push(serde_json::to_value(&track.metadata_json).unwrap_or(serde_json::Value::Null));
        mb_release_group_ids.push(track.mb_release_group_id.clone());
        mb_release_ids.push(track.mb_release_id.clone());
        mb_album_artist_ids.push(track.mb_album_artist_id.clone());
    }

    let play_counts: Vec<i32> = vec![0; len];
    let created: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "playCount", "createdAt", "updatedAt", "mbReleaseGroupId", "mbReleaseId", "mbAlbumArtistId")
           SELECT * FROM UNNEST(
               $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
               $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::int[], $14::int[],
               $15::text[], $16::bigint[], $17::timestamp[], $18::text[], $19::jsonb[],
               $20::int[], $21::timestamp[], $22::timestamp[], $23::text[], $24::text[], $25::text[]
           )
           ON CONFLICT ("filePath") DO UPDATE SET
             title = EXCLUDED.title, artist = EXCLUDED.artist, "albumArtist" = EXCLUDED."albumArtist",
             album = EXCLUDED.album, year = EXCLUDED.year, genre = EXCLUDED.genre,
             duration = EXCLUDED.duration, bitrate = EXCLUDED.bitrate, "sampleRate" = EXCLUDED."sampleRate",
             position = EXCLUDED.position, "trackNumber" = EXCLUDED."trackNumber", "discNumber" = EXCLUDED."discNumber",
             "localReleaseId" = EXCLUDED."localReleaseId", "fileSize" = EXCLUDED."fileSize",
             mtime = EXCLUDED.mtime, "contentHash" = EXCLUDED."contentHash", metadata = EXCLUDED.metadata,
             "mbReleaseGroupId" = EXCLUDED."mbReleaseGroupId", "mbReleaseId" = EXCLUDED."mbReleaseId",
             "mbAlbumArtistId" = EXCLUDED."mbAlbumArtistId",
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
    .bind(&play_counts)
    .bind(&created)
    .bind(&created)
    .bind(&mb_release_group_ids)
    .bind(&mb_release_ids)
    .bind(&mb_album_artist_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, path)| (path, id)).collect())
}

pub async fn batch_ensure_track_related_artists(
    pool: &PgPool,
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
    .execute(pool)
    .await?;

    Ok(())
}

#[derive(Debug, Default)]
pub struct RelinkStats {
    pub tracks_scanned: u64,
    pub links_added: u64,
    pub links_removed: u64,
}

/// Rebuild TrackRelatedArtist for every track: a credit is kept only when the credited name resolves to
/// an artist that already owns a release via LocalReleaseArtist - no Artist row is ever created for a
/// name that appears solely as a credit. Run once at the end of a full index pass (also available
/// standalone via `--relink-credits`, or skippable via `--skip-relink`) so credits resolve regardless of
/// folder scan order: an artist indexed after the release that credits them still gets linked once this
/// pass runs, since it always re-derives from the full current Artist table rather than whatever existed
/// mid-loop.
pub async fn relink_track_credits(pool: &PgPool) -> RelinkStats {
    let mut stats = RelinkStats::default();

    // slug -> id, restricted to artists that own at least one release - the definition of "already
    // exists" under the no-credit-only-rows model.
    let artist_rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT DISTINCT a.slug, a.id FROM "Artist" a
           WHERE EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id)"#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let artist_by_slug: HashMap<String, String> = artist_rows.into_iter().collect();

    // releaseId -> its main artist ids, so a track never credits its own release's artist.
    let lra_rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "localReleaseId", "artistId" FROM "LocalReleaseArtist""#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut main_artists_by_release: HashMap<String, HashSet<String>> = HashMap::new();
    for (release_id, artist_id) in lra_rows {
        main_artists_by_release.entry(release_id).or_default().insert(artist_id);
    }

    const BATCH: i64 = 5000;
    let mut last_id = String::new();
    loop {
        let batch: Vec<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT id, artist, "albumArtist", "localReleaseId" FROM "LocalReleaseTrack"
               WHERE id > $1 AND artist IS NOT NULL AND artist <> ''
               ORDER BY id LIMIT $2"#,
        )
        .bind(&last_id)
        .bind(BATCH)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        if batch.is_empty() {
            break;
        }
        last_id = batch.last().map(|(id, ..)| id.clone()).unwrap_or_default();
        stats.tracks_scanned += batch.len() as u64;

        let track_ids: Vec<String> = batch.iter().map(|(id, ..)| id.clone()).collect();
        let existing_rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT "trackId", "artistId" FROM "TrackRelatedArtist" WHERE "trackId" = ANY($1::text[])"#,
        )
        .bind(&track_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        let existing: HashSet<(String, String)> = existing_rows.into_iter().collect();

        let mut desired: HashSet<(String, String)> = HashSet::new();
        for (track_id, artist_tag, album_artist_tag, release_id) in &batch {
            let Some(artist_tag) = artist_tag else { continue };
            let album_artist_lower = album_artist_tag.as_deref().unwrap_or("").to_lowercase();
            let (main, feat) = split_artists(artist_tag);
            let release_main_ids = release_id.as_ref().and_then(|rid| main_artists_by_release.get(rid));

            let mut seen: HashSet<String> = HashSet::new();
            for name in main.into_iter().chain(feat.into_iter()) {
                let lower = name.to_lowercase();
                if lower == album_artist_lower || !seen.insert(lower) {
                    continue;
                }
                let slug = make_slug(&name);
                if slug.is_empty() {
                    continue;
                }
                let Some(artist_id) = artist_by_slug.get(&slug) else { continue };
                if release_main_ids.map(|s| s.contains(artist_id)).unwrap_or(false) {
                    continue;
                }
                desired.insert((track_id.clone(), artist_id.clone()));
            }
        }

        let to_insert: Vec<(String, String)> = desired.difference(&existing).cloned().collect();
        let to_remove: Vec<(String, String)> = existing.difference(&desired).cloned().collect();

        if !to_remove.is_empty() {
            let (rt, ra): (Vec<String>, Vec<String>) = to_remove.into_iter().unzip();
            sqlx::query(
                r#"DELETE FROM "TrackRelatedArtist" t
                   USING UNNEST($1::text[], $2::text[]) AS d(track_id, artist_id)
                   WHERE t."trackId" = d.track_id AND t."artistId" = d.artist_id"#,
            )
            .bind(&rt)
            .bind(&ra)
            .execute(pool)
            .await
            .ok();
            stats.links_removed += rt.len() as u64;
        }

        if !to_insert.is_empty() {
            stats.links_added += to_insert.len() as u64;
            batch_ensure_track_related_artists(pool, &to_insert).await.ok();
        }
    }

    stats
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
pub async fn update_last_indexed_at(pool: &PgPool, artist_ids: &[String]) -> Result<(), sqlx::Error> {
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

pub async fn propagate_mb_artist_id(
    pool: &PgPool,
    artist_id: &str,
) -> Result<(), sqlx::Error> {
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#,
    )
    .bind(artist_id)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(ref mb_id),)) = existing {
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
        sqlx::query(
            r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
               WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
        )
        .bind(&rows[0].0)
        .bind(artist_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Run-hash resumability
// ---------------------------------------------------------------------------

pub async fn load_indexed_folders(
    pool: &PgPool,
    hash: &str,
) -> std::collections::HashSet<String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "folderPath" FROM "FolderScan" WHERE "indexHash" = $1"#,
    )
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
        let a = build_group_key("Portrait", Some(1986), "Teddy Wilson", "Teddy Wilson/Album/2011 - Jazz Heroes");
        let b = build_group_key("Different Album", Some(1999), "Teddy Wilson", "Teddy Wilson/Album/2011 - Jazz Heroes");
        assert_eq!(a, b);
        assert_eq!(a, "folder:Teddy Wilson/Album/2011 - Jazz Heroes");
    }

    #[test]
    fn group_key_distinguishes_different_folders() {
        let a = build_group_key("Guitar Town", Some(1986), "Steve Earle", "Steve Earle/Album/1986 - Guitar Town");
        let b = build_group_key("Guitar Town", Some(1986), "Steve Earle", "Steve Earle/Remastered/1986 - Guitar Town [2002]");
        assert_ne!(a, b);
    }

    #[test]
    fn group_key_falls_back_to_meta_when_no_folder() {
        let k = build_group_key("Some Album", Some(1990), "Some Artist", "");
        assert_eq!(k, "meta:some-album:1990:some-artist");
    }

    #[test]
    fn folder_majority_picks_mode_album_and_year() {
        let tracks = vec![
            (Some("Real Album".to_string()), Some(1986)),
            (Some("Real Album".to_string()), Some(1986)),
            (Some("Stray Tag".to_string()), Some(2016)),
        ];
        assert_eq!(folder_majority_title_year(&tracks), ("Real Album".to_string(), Some(1986)));
    }

    #[test]
    fn folder_majority_ignores_empty_albums_and_falls_back() {
        let tracks = vec![
            (Some("   ".to_string()), None),
            (None, None),
        ];
        assert_eq!(folder_majority_title_year(&tracks), ("Unknown Album".to_string(), None));
    }

    #[test]
    fn folder_majority_year_independent_of_album_mode() {
        let tracks = vec![
            (Some("A".to_string()), Some(2000)),
            (Some("B".to_string()), Some(2000)),
            (Some("A".to_string()), Some(1999)),
        ];
        // Album mode = "A", year mode = 2000 (computed independently).
        assert_eq!(folder_majority_title_year(&tracks), ("A".to_string(), Some(2000)));
    }

    #[test]
    fn strip_disc_subfolder_collapses_disc_dirs() {
        assert_eq!(strip_disc_subfolder("Artist/Album/CD1"), "Artist/Album");
        assert_eq!(strip_disc_subfolder("Artist/Album/Disc 2"), "Artist/Album");
        assert_eq!(strip_disc_subfolder("Artist/Album"), "Artist/Album");
        // Non-pure-digit suffix is NOT a disc folder (known box-set gap, left as-is).
        assert_eq!(strip_disc_subfolder("Artist/Box/CD2 - Warmin' Up"), "Artist/Box/CD2 - Warmin' Up");
    }
}

