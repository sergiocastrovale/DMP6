use sqlx::PgPool;
use std::collections::HashSet;

// Group discovery - DB only
// ---------------------------------------------------------------------------

pub(crate) struct SiblingRow {
    pub(crate) local_id: String,
    pub(crate) folder_path: String,
    /// Unanimous only (docs/no_guessing.md) - never a plurality. `NULL` when the folder's tracks
    /// carry no `mbReleaseId` at all, or disagree on it.
    pub(crate) unanimous_mb_release_id: Option<String>,
    /// This folder already sits on a medium (`mediumPosition`) or came out of a dissolve
    /// (`boxReleaseId`). A group where every sibling is placed needs no MusicBrainz call to be
    /// re-checked - see `candidates_from_db`.
    pub(crate) placed: bool,
}

pub(crate) struct SiblingGroup {
    pub(crate) parent: String,
    pub(crate) rows: Vec<SiblingRow>,
    /// Found by `nested_groups` - a root folder plus folders beneath it, all bound to one multi-disc
    /// release - rather than as folders sharing a parent. Its candidate is taken from the database
    /// first, since every member is by definition already bound to it.
    pub(crate) nested: bool,
}

/// Folders sharing a parent, at least two of them, none yet folded into one `LocalRelease` - the
/// same directory shape `multi_disc` looks at, but grouped by path rather than a shared embedded id,
/// since a box's siblings frequently carry entirely different (and individually correct-looking)
/// embedded release ids (shape (b), see module docs).
///
/// `scope`, when given, is a list of artist ids: a whole sibling group is kept if **any** folder in
/// it is owned by one of those artists (via `LocalReleaseArtist`) - siblings owned by a different,
/// unscoped artist stay in the group rather than being dropped out of it, since the box must be
/// bound/folded/dissolved as one unit regardless of which artist happened to trigger the run (a box
/// filed under a collaborator's folder still belongs to the artist credited on it - see
/// docs/sync_decisions.md). `None` scopes nothing (every group, tidy's `--all`).
pub(crate) async fn find_sibling_groups(
    pool: &PgPool,
    scope: Option<&[String]>,
) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>, bool)> = sqlx::query_as(
        r#"
        WITH f AS (
          SELECT lr.id, lr."folderPath" AS folder_path,
                 regexp_replace(lr."folderPath", '/[^/]+$', '') AS parent,
                 (SELECT CASE WHEN count(DISTINCT t."mbReleaseId") = 1
                              THEN min(t."mbReleaseId") END
                    FROM "LocalReleaseTrack" t
                   WHERE t."localReleaseId" = lr.id AND t."mbReleaseId" IS NOT NULL) AS unanimous_mb_release_id,
                 (lr."mediumPosition" IS NOT NULL OR lr."boxReleaseId" IS NOT NULL) AS placed
          FROM "LocalRelease" lr
          WHERE lr."folderPath" IS NOT NULL
            AND array_length(string_to_array(lr."folderPath", '/'), 1) >= 4
        )
        SELECT f.id, f.folder_path, f.parent, f.unanimous_mb_release_id, f.placed
        FROM f
        WHERE f.parent IN (SELECT parent FROM f GROUP BY parent HAVING count(*) > 1)
          AND ($1::text[] IS NULL OR f.parent IN (
                SELECT f2.parent FROM f f2
                JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = f2.id
                WHERE lra."artistId" = ANY($1)
              ))
        ORDER BY f.parent, f.folder_path
        "#,
    )
    .bind(scope)
    .fetch_all(pool)
    .await?;

    let mut groups: Vec<SiblingGroup> = Vec::new();
    for (id, folder_path, parent, unanimous_mb, placed) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            unanimous_mb_release_id: unanimous_mb,
            placed,
        };
        match groups.last_mut() {
            Some(g) if g.parent == parent => g.rows.push(row),
            _ => groups.push(SiblingGroup {
                parent,
                rows: vec![row],
                nested: false,
            }),
        }
    }

    let already_grouped: HashSet<String> = groups
        .iter()
        .flat_map(|g| g.rows.iter().map(|r| r.local_id.clone()))
        .collect();
    groups.extend(nested_groups(pool, scope, &already_grouped).await?);
    Ok(groups)
}

/// Discs filed as a **root folder plus subfolders** rather than as siblings: disc 1's files sit in the
/// release folder itself and disc 2 in a folder beneath it (`…/2004 - Blast Tyrant` holding CD 1,
/// `…/2004 - Blast Tyrant/CD 2 - Bonus Disc` holding CD 2). `find_sibling_groups` groups folders by
/// their common parent, so it never sees these two together - the root's parent is the artist's type
/// folder, not the album folder. Both were bound to the whole multi-disc release, never placed, and each
/// scored against the full tracklist: two `MISSING_TRACKS` cards for one complete album.
///
/// A group is a root `LocalRelease` plus every `LocalRelease` beneath its folder, all bound to the same
/// `mediumCount > 1` release, none yet placed (`mediumPosition`/`boxReleaseId`) or folded
/// (`LocalReleaseMember`). Once found, it goes through exactly the same bind / equivalence /
/// fold-or-dissolve pipeline as a sibling group - nothing about binding changes, only discovery.
///
/// Deliberately **not** grouped: folders bound to one release that sit in *unrelated* trees (two
/// spellings of an artist, a duplicate copy filed elsewhere). A root-plus-subfolder layout is evidence the
/// folders are one physical release; two separate trees is not.
///
/// A group sharing any folder with a sibling group is skipped, so the box pass keeps handling those
/// exactly as before. Roots are taken shortest path first and a folder is only ever used once, so a
/// three-level tree cannot produce two overlapping groups.
async fn nested_groups(
    pool: &PgPool,
    scope: Option<&[String]>,
    already_grouped: &HashSet<String>,
) -> Result<Vec<SiblingGroup>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        WITH lr AS (
          SELECT l.id, l."folderPath" AS fp, l."releaseId" AS rid
          FROM "LocalRelease" l
          WHERE l."folderPath" IS NOT NULL AND l."releaseId" IS NOT NULL
            AND l."mediumPosition" IS NULL AND l."boxReleaseId" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "LocalReleaseMember" m WHERE m."localReleaseId" = l.id)
        ),
        roots AS (
          SELECT r.id AS root_id, r.fp AS root_fp, r.rid
          FROM lr r
          JOIN "MusicBrainzRelease" m ON m.id = r.rid AND m."mediumCount" > 1
          WHERE EXISTS (SELECT 1 FROM lr c
                        WHERE c.rid = r.rid AND left(c.fp, length(r.fp) + 1) = r.fp || '/')
        ),
        members AS (
          SELECT r.root_fp, c.id, c.fp
          FROM roots r
          JOIN lr c ON c.rid = r.rid
                   AND (c.id = r.root_id OR left(c.fp, length(r.root_fp) + 1) = r.root_fp || '/')
        )
        SELECT mem.root_fp, mem.id, mem.fp,
               (SELECT CASE WHEN count(DISTINCT t."mbReleaseId") = 1
                            THEN min(t."mbReleaseId") END
                  FROM "LocalReleaseTrack" t
                 WHERE t."localReleaseId" = mem.id AND t."mbReleaseId" IS NOT NULL)
        FROM members mem
        WHERE $1::text[] IS NULL OR mem.root_fp IN (
                SELECT m2.root_fp FROM members m2
                JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = m2.id
                WHERE lra."artistId" = ANY($1))
        ORDER BY length(mem.root_fp), mem.root_fp, mem.fp
        "#,
    )
    .bind(scope)
    .fetch_all(pool)
    .await?;

    let mut candidates: Vec<SiblingGroup> = Vec::new();
    for (root, id, folder_path, unanimous_mb) in rows {
        let row = SiblingRow {
            local_id: id,
            folder_path,
            unanimous_mb_release_id: unanimous_mb,
            placed: false,
        };
        match candidates.last_mut() {
            Some(g) if g.parent == root => g.rows.push(row),
            _ => candidates.push(SiblingGroup {
                parent: root,
                rows: vec![row],
                nested: true,
            }),
        }
    }

    Ok(keep_disjoint_groups(candidates, already_grouped))
}

/// Keep candidate groups in order, dropping any that shares a folder with a sibling group or with a
/// group already kept, and any under two folders. Candidates arrive shortest root path first, so an
/// outer root always claims its whole tree before a nested sub-root could claim part of it.
pub(crate) fn keep_disjoint_groups(
    candidates: Vec<SiblingGroup>,
    already_grouped: &HashSet<String>,
) -> Vec<SiblingGroup> {
    let mut used: HashSet<String> = HashSet::new();
    let mut groups = Vec::new();
    for g in candidates {
        let overlaps = g
            .rows
            .iter()
            .any(|r| already_grouped.contains(&r.local_id) || used.contains(&r.local_id));
        if overlaps || g.rows.len() < 2 {
            continue;
        }
        used.extend(g.rows.iter().map(|r| r.local_id.clone()));
        groups.push(g);
    }
    groups
}

pub(crate) async fn sibling_tracks(
    pool: &PgPool,
    local_id: &str,
) -> Result<Vec<(String, String, Option<i32>)>, sqlx::Error> {
    let rows: Vec<(String, Option<String>, Option<i32>)> = sqlx::query_as(
        r#"SELECT id, title, duration FROM "LocalReleaseTrack"
           WHERE "localReleaseId" = $1
           ORDER BY "trackNumber" ASC NULLS LAST, id ASC"#,
    )
    .bind(local_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, dur)| (id, title.unwrap_or_default(), dur))
        .collect())
}

/// The MB id(s) of any `mediumCount > 1` release a sibling in this group is *already* bound to - a
/// disc the ordinary album matcher bound whole-box (tags name the box, not the disc; see §10) already
/// names the right release, so re-discovering it by tag consensus or MB search is redundant, and for a
/// library with no useful tags at all (every embedded id absent or pointing elsewhere) it is the only
/// source that finds the box. Merged into tier (a)'s id set, so no extra MB call when the two agree.
pub(crate) async fn bound_box_mb_ids(pool: &PgPool, local_ids: &[String]) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        r#"SELECT DISTINCT m."musicbrainzId" FROM "LocalRelease" lr
           JOIN "MusicBrainzRelease" m ON m.id = lr."releaseId"
           WHERE lr.id = ANY($1) AND m."mediumCount" > 1"#,
    )
    .bind(local_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

pub(crate) async fn artist_for_group(
    pool: &PgPool,
    local_ids: &[String],
) -> Option<(String, String)> {
    sqlx::query_as(
        r#"SELECT a.id, a.name FROM "Artist" a
           JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
           WHERE lra."localReleaseId" = ANY($1)
           LIMIT 1"#,
    )
    .bind(local_ids)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

// ---------------------------------------------------------------------------
