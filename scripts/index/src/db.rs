use chrono::{NaiveDateTime, Utc};
use common::types::TrackMeta;
use slug::slugify;
use sqlx::PgPool;
use std::collections::{BTreeSet, HashMap};

/// What one candidate folder-release contributes to the multi-disc decision. Built from tags only -
/// the folder path is carried along as an identity/display anchor, never parsed for meaning.
#[derive(Debug, Clone)]
pub struct FolderFacts {
    pub folder_path: String,
    /// Majority embedded MusicBrainz *release* id across the folder's tracks (already sanitized).
    /// `None` when no track carries one - the metadata signal is simply absent for that folder.
    pub majority_mb_release_id: Option<String>,
    /// Distinct disc numbers claimed by the folder's tracks. An untagged track counts as disc 1,
    /// matching how a single-disc release reads.
    pub disc_numbers: BTreeSet<i32>,
}

/// Where a folder's tracks should actually land once multi-disc folders are merged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeTarget {
    pub group_key: String,
    pub folder_path: String,
    /// Every folder path folded into this release, the planned one included. Lets the caller adopt
    /// (re-key + absorb) the rows a previous, unmerged index run left behind.
    pub member_folders: Vec<String>,
}

/// Longest common ancestor of two folder paths, on `/` boundaries. `""` when they share no prefix.
fn common_ancestor(a: &str, b: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for (sa, sb) in a.split('/').zip(b.split('/')) {
        if sa != sb {
            break;
        }
        out.push(sa);
    }
    out.join("/")
}

/// Decide which folders are discs of one release and therefore belong in a single `LocalRelease`.
///
/// **Metadata decides this, not folder names.** Two folders merge iff their tracks agree on the
/// majority embedded MB *release* id and their disc-number sets are disjoint. That is exactly what
/// MusicBrainz already asserts: one release, several media. Names like `CD 1 (Vol 3)`, `LP 2`,
/// `Disc One` or `CD 2 - Live` carry no weight.
///
/// A box set whose discs each carry a *different* embedded id (mis-tagged as their own standalone
/// albums, or genuinely tagged as their own albums - see docs/box_sets.md §2) is left unmerged here,
/// not because that is correct - MusicBrainz models a box as one Release with N media, so those discs
/// really do belong together - but because this function can only see embedded ids, and MB stores no
/// id-level link from a box's disc to the album it duplicates. `sync::boxset::run_repair` is the
/// tier-2 pass that matches by tracklist instead and folds those cases afterwards.
///
/// Overlapping disc numbers mean two folders both claim the same medium - duplicate rips of one
/// album, not two halves of it - so they stay separate and surface via the duplicate-release audit.
///
/// This is NOT the reverted fragmentation bug. That one put *per-track* MB ids into the group key
/// and shredded compilations into per-track fragments. This keys on the folder exactly as before
/// and only ever *merges* whole folders, which cannot shred anything.
pub fn plan_disc_merges(folders: &[FolderFacts]) -> HashMap<String, MergeTarget> {
    let mut by_release: HashMap<&str, Vec<&FolderFacts>> = HashMap::new();
    for f in folders {
        if let Some(id) = f.majority_mb_release_id.as_deref() {
            by_release.entry(id).or_default().push(f);
        }
    }

    let mut plan: HashMap<String, MergeTarget> = HashMap::new();
    for (release_id, mut members) in by_release {
        if members.len() < 2 {
            continue;
        }
        // Stable order so the chosen folder_path/ancestor never depends on HashMap iteration.
        members.sort_by(|a, b| a.folder_path.cmp(&b.folder_path));

        // Keep only folders whose discs nothing else claims. A folder overlapping any other is a
        // duplicate rip: drop it from the group rather than guessing which copy is canonical.
        let mut seen: HashMap<i32, usize> = HashMap::new();
        for f in &members {
            for d in &f.disc_numbers {
                *seen.entry(*d).or_insert(0) += 1;
            }
        }
        let disjoint: Vec<&FolderFacts> = members
            .iter()
            .copied()
            .filter(|f| f.disc_numbers.iter().all(|d| seen.get(d) == Some(&1)))
            .collect();
        if disjoint.len() < 2 {
            continue;
        }

        let ancestor = disjoint
            .iter()
            .skip(1)
            .fold(disjoint[0].folder_path.clone(), |acc, f| {
                common_ancestor(&acc, &f.folder_path)
            });
        let folder_path = if ancestor.is_empty() {
            disjoint[0].folder_path.clone()
        } else {
            ancestor
        };
        let member_folders: Vec<String> =
            disjoint.iter().map(|f| f.folder_path.clone()).collect();
        let target = MergeTarget {
            group_key: format!("mbrelease:{}", release_id),
            folder_path,
            member_folders,
        };
        for f in disjoint {
            plan.insert(f.folder_path.clone(), target.clone());
        }
    }
    plan
}

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

/// Display title/year for a folder-release: the most common (mode) non-empty album tag and the most
/// common year among the folder's tracks, computed from a fixed insertion order so the same input
/// always yields the same result. Falls back to "Unknown Album" / None when the folder has no usable
/// album/year tags. Sync overrides these with the MusicBrainz match when one is found; this is the
/// pre-match, tag-derived display value.
pub fn folder_majority_title_year(
    tracks: &[(Option<String>, Option<i32>)],
) -> (String, Option<i32>) {
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
    let year = year_counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(v, _)| v);
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

/// Land a merged multi-disc release on ONE row, absorbing whatever a previous unmerged run left.
///
/// Without this, a re-index of an already-split release would insert a third row under the new
/// `mbrelease:` key and leave the two `folder:` rows behind holding their tracks (a plain index
/// skips known file paths, so it never re-links them). So: adopt the existing rows - re-key the
/// survivor, move the others' tracks onto it, delete the emptied ones - then upsert as usual.
pub async fn ensure_merged_local_release(
    pool: &PgPool,
    title: &str,
    year: Option<i32>,
    target: &MergeTarget,
    cache: &mut HashMap<String, String>,
) -> Result<String, sqlx::Error> {
    if let Some(id) = cache.get(&target.group_key) {
        return Ok(id.clone());
    }

    let member_keys: Vec<String> = target
        .member_folders
        .iter()
        .map(|f| format!("folder:{}", f))
        .collect();

    // Oldest first: the survivor keeps the earliest row's identity (and its play counts/favourites).
    let existing: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "LocalRelease"
           WHERE "groupKey" = $1 OR "groupKey" = ANY($2)
           ORDER BY "createdAt" ASC"#,
    )
    .bind(&target.group_key)
    .bind(&member_keys)
    .fetch_all(pool)
    .await?;

    if let Some((survivor,)) = existing.first().cloned() {
        let losers: Vec<String> = existing.into_iter().skip(1).map(|(id,)| id).collect();
        if !losers.is_empty() {
            let now = Utc::now().naive_utc();
            sqlx::query(
                r#"UPDATE "LocalReleaseTrack" SET "localReleaseId" = $1, "updatedAt" = $2
                   WHERE "localReleaseId" = ANY($3)"#,
            )
            .bind(&survivor)
            .bind(now)
            .bind(&losers)
            .execute(pool)
            .await?;
            sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1)"#)
                .bind(&losers)
                .execute(pool)
                .await?;
        }
        // Re-key onto the metadata-derived key and re-score on the next sync.
        sqlx::query(
            r#"UPDATE "LocalRelease"
               SET "groupKey" = $1, "folderPath" = $2, "matchStatus" = 'UNKNOWN', "updatedAt" = $3
               WHERE id = $4"#,
        )
        .bind(&target.group_key)
        .bind(&target.folder_path)
        .bind(Utc::now().naive_utc())
        .bind(&survivor)
        .execute(pool)
        .await?;
        cache.insert(target.group_key.clone(), survivor.clone());
        return Ok(survivor);
    }

    let id = ensure_local_release(pool, title, year, &target.folder_path, &target.group_key).await?;
    cache.insert(target.group_key.clone(), id.clone());
    Ok(id)
}

/// Every folder `sync::boxset::run_repair` has already folded into a box-set `LocalRelease`, keyed
/// by folder path. `plan_disc_merges` cannot rediscover these on its own - it only ever sees embedded
/// MB release ids, and MB stores no id-level link from a box's disc to the standalone album it
/// duplicates (docs/box_sets.md §2) - so a folder found here must be routed straight to its existing
/// release, never through `build_group_key`/`ensure_local_release_cached`. Without this, a box whose
/// discs are individually tagged as their own standalone albums (every track reads discNumber=1,
/// shape (b) in docs/box_sets.md) would have its title/year rewritten from that disc's own tags and,
/// worse, its folderPath's `groupKey` regenerated fresh on the very next full re-index that touches
/// it - splitting the box straight back apart. One query, small table, fetched once per index run.
pub async fn get_local_release_members(pool: &PgPool) -> Result<HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "folderPath", "localReleaseId" FROM "LocalReleaseMember""#,
    )
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

    let play_counts: Vec<i32> = vec![0; len];
    let created: Vec<NaiveDateTime> = vec![now; len];

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"INSERT INTO "LocalReleaseTrack"
           (id, title, artist, "albumArtist", album, year, genre,
            duration, bitrate, "sampleRate", "filePath", position, "trackNumber", "discNumber",
            "localReleaseId", "fileSize", mtime, "contentHash", metadata,
            "playCount", "createdAt", "updatedAt", "mbReleaseGroupId", "mbReleaseId", "mbAlbumArtistId",
            artists, "mbArtistIds", "albumArtists", "mbAlbumArtistIds")
           SELECT t.id, t.title, t.artist, t.album_artist, t.album, t.year, t.genre,
                  t.duration, t.bitrate, t.sample_rate, t.file_path, t.position, t.track_number, t.disc_number,
                  t.release_id, t.file_size, t.mtime, t.content_hash, t.metadata,
                  t.play_count, t.created, t.updated, t.mb_rg_id, t.mb_rel_id, t.mb_aa_id,
                  ARRAY(SELECT jsonb_array_elements_text(t.artists_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.mb_artist_ids_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.album_artists_json)),
                  ARRAY(SELECT jsonb_array_elements_text(t.mb_album_artist_ids_json))
           FROM UNNEST(
               $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
               $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::int[], $14::int[],
               $15::text[], $16::bigint[], $17::timestamp[], $18::text[], $19::jsonb[],
               $20::int[], $21::timestamp[], $22::timestamp[], $23::text[], $24::text[], $25::text[],
               $26::jsonb[], $27::jsonb[], $28::jsonb[], $29::jsonb[]
           ) AS t(id, title, artist, album_artist, album, year, genre,
                  duration, bitrate, sample_rate, file_path, position, track_number, disc_number,
                  release_id, file_size, mtime, content_hash, metadata,
                  play_count, created, updated, mb_rg_id, mb_rel_id, mb_aa_id,
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
    .bind(&play_counts)
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
    let existing: Option<(Option<String>,)> =
        sqlx::query_as(r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#)
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
    fn folder_majority_picks_mode_album_and_year() {
        let tracks = vec![
            (Some("Real Album".to_string()), Some(1986)),
            (Some("Real Album".to_string()), Some(1986)),
            (Some("Stray Tag".to_string()), Some(2016)),
        ];
        assert_eq!(
            folder_majority_title_year(&tracks),
            ("Real Album".to_string(), Some(1986))
        );
    }

    #[test]
    fn folder_majority_ignores_empty_albums_and_falls_back() {
        let tracks = vec![(Some("   ".to_string()), None), (None, None)];
        assert_eq!(
            folder_majority_title_year(&tracks),
            ("Unknown Album".to_string(), None)
        );
    }

    #[test]
    fn folder_majority_year_independent_of_album_mode() {
        let tracks = vec![
            (Some("A".to_string()), Some(2000)),
            (Some("B".to_string()), Some(2000)),
            (Some("A".to_string()), Some(1999)),
        ];
        // Album mode = "A", year mode = 2000 (computed independently).
        assert_eq!(
            folder_majority_title_year(&tracks),
            ("A".to_string(), Some(2000))
        );
    }

    fn facts(folder: &str, mb: Option<&str>, discs: &[i32]) -> FolderFacts {
        FolderFacts {
            folder_path: folder.to_string(),
            majority_mb_release_id: mb.map(|s| s.to_string()),
            disc_numbers: discs.iter().copied().collect(),
        }
    }

    #[test]
    fn merges_two_disc_folders_that_share_a_release_id() {
        // The Jordan Lake Sessions: two folders, one MB release, discs 1 and 2. Folder names
        // ("CD 1 (Vol 3)") are never consulted - only the tags.
        let plan = plan_disc_merges(&[
            facts("MG/Album/Jordan Lake/CD 1 (Vol 3)", Some("mb-jordan"), &[1]),
            facts("MG/Album/Jordan Lake/CD 2 (Vol 4)", Some("mb-jordan"), &[2]),
        ]);

        let a = plan.get("MG/Album/Jordan Lake/CD 1 (Vol 3)").expect("merged");
        assert_eq!(a.group_key, "mbrelease:mb-jordan");
        assert_eq!(a.folder_path, "MG/Album/Jordan Lake");
        assert_eq!(a.member_folders.len(), 2);
        assert_eq!(plan.get("MG/Album/Jordan Lake/CD 2 (Vol 4)"), Some(a));
    }

    #[test]
    fn defers_a_mis_tagged_box_disc_to_the_tier_2_matcher() {
        // ABBA's 9CD box: CD 1 is tagged as the standalone "Ring Ring" release, CDs 2-3 as the box.
        // Verified against the live MusicBrainz API (docs/box_sets.md §2): a box set is NOT a
        // collection of separate releases - it is one Release with N media, and MB stores no link
        // from a box's disc to the standalone album it duplicates. So CD 1 genuinely belongs in this
        // box too; plan_disc_merges just can't see that from tags alone, since it only ever merges
        // folders that already agree on an embedded release id. It correctly merges the two that do
        // agree (CD 2+3) and leaves CD 1 as its own row - not because that is the right final state,
        // but so `sync::boxset::run_repair`'s tier-2 tracklist matcher (which has no such blind spot)
        // can pick it up afterwards and fold all three into the box.
        let plan = plan_disc_merges(&[
            facts("ABBA/Box/CD 1-1973 - Ring Ring", Some("mb-ringring"), &[1]),
            facts("ABBA/Box/CD 2-1974 - Waterloo", Some("mb-box"), &[2]),
            facts("ABBA/Box/CD 3-1975 - ABBA", Some("mb-box"), &[3]),
        ]);

        assert!(!plan.contains_key("ABBA/Box/CD 1-1973 - Ring Ring"));
        assert_eq!(
            plan.get("ABBA/Box/CD 2-1974 - Waterloo").map(|t| t.group_key.as_str()),
            Some("mbrelease:mb-box"),
        );
        assert!(plan.contains_key("ABBA/Box/CD 3-1975 - ABBA"));
    }

    #[test]
    fn refuses_duplicate_rips_that_claim_the_same_disc() {
        // Same album ripped into two folders: both claim disc 1, so they are copies, not halves.
        let plan = plan_disc_merges(&[
            facts("A/Album [FLAC]", Some("mb-x"), &[1]),
            facts("A/Album [MP3]", Some("mb-x"), &[1]),
        ]);

        assert!(plan.is_empty());
    }

    #[test]
    fn a_contested_disc_holds_up_the_whole_group() {
        // Discs 1+2 plus a third folder re-ripping disc 1. Which of the two disc-1 folders is the
        // real half is unknowable from tags, and merging the wrong one would bury a duplicate
        // inside the release - so the group is left alone entirely for the audit to surface.
        let plan = plan_disc_merges(&[
            facts("A/Album/CD1", Some("mb-x"), &[1]),
            facts("A/Album/CD2", Some("mb-x"), &[2]),
            facts("A/Album copy", Some("mb-x"), &[1]),
        ]);

        assert!(plan.is_empty());
    }

    #[test]
    fn no_embedded_release_id_means_no_merge() {
        // Nothing to go on but folder names - left to strip_disc_subfolder's fallback.
        let plan = plan_disc_merges(&[
            facts("A/Album/CD 1 (Live)", None, &[1]),
            facts("A/Album/CD 2 (Studio)", None, &[2]),
        ]);

        assert!(plan.is_empty());
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
