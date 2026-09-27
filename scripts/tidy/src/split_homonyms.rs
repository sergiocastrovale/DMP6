//! `./tidy --split-homonyms`: the one-off repair for artists merged under one name before homonyms were told apart
//! (docs/sync_decisions.md "Two artists, one name").
//!
//! Nothing here decides ownership itself. It finds every artist owning a release whose files name a different
//! MusicBrainz artist than the row holds, and re-runs the index's own resolve pass over those artists' releases - the
//! same rules a fresh index applies (common::homonyms), including the MusicBrainz check that tells a second real
//! artist with the name from a mistagged file. The pass reconciles every name group it touches.

use std::collections::BTreeSet;

use common::progress::Reporter;
use index::resolve::{resolve_and_apply, ArtistResolver, Decision};
use sqlx::PgPool;

/// The homonym signature: files whose album-artist tag *is this artist's own name* but whose single album-artist id is
/// not the row's. Two shapes count - the row has an id and some of its files name another one, or the row has none and
/// its files name two or more. A file naming a co-owner or a collaboration ("A & B", the partner's id) is not a
/// homonym, and a row with no id whose files all name one artist only needs identifying, which sync does; neither is
/// a candidate. Measured on the live library: 223 artists (the looser "any other id" test matched 5,450).
const HOMONYM_TRACKS: &str = r#"
    FROM "Artist" a
    JOIN "LocalReleaseArtist" l ON l."artistId" = a.id
    JOIN "LocalReleaseTrack" t ON t."localReleaseId" = l."localReleaseId"
    WHERE a."primaryArtistId" IS NULL
      AND cardinality(COALESCE(t."mbAlbumArtistIds", '{}')) = 1
      AND t."mbAlbumArtistIds"[1] ~ '^[0-9a-f-]{36}$'
      AND t."mbAlbumArtistIds"[1] <> '89ad4ac3-39f7-470e-963a-56509c546377'
      AND lower(btrim(t."albumArtist")) = lower(btrim(a.name))"#;

async fn candidates(pool: &PgPool) -> Result<Vec<(String, String, Option<String>)>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"SELECT a.id, a.name, NULLIF(a."musicbrainzId", '') {HOMONYM_TRACKS}
           GROUP BY a.id, a.name, a."musicbrainzId"
           HAVING (NULLIF(a."musicbrainzId", '') IS NOT NULL
                   AND bool_or(t."mbAlbumArtistIds"[1] IS DISTINCT FROM NULLIF(a."musicbrainzId", '')))
               OR count(DISTINCT t."mbAlbumArtistIds"[1]) > 1
           ORDER BY a.name"#
    ))
    .fetch_all(pool)
    .await
}

/// Per candidate: each id its own-name files carry, with how many releases carry it.
async fn ids_by_release_count(pool: &PgPool, artist_id: &str) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"SELECT t."mbAlbumArtistIds"[1], count(DISTINCT t."localReleaseId") {HOMONYM_TRACKS} AND a.id = $1
           GROUP BY 1 ORDER BY 2 DESC"#
    ))
    .bind(artist_id)
    .fetch_all(pool)
    .await
}

/// Returns the process exit code.
pub async fn run(pool: &PgPool, config: &common::config::Config, reporter: &Reporter, dry_run: bool, emit_ids: Option<&str>) -> i32 {
    reporter.section("Homonym split");
    let found = match candidates(pool).await {
        Ok(c) => c,
        Err(e) => {
            reporter.err(&format!("Candidate query failed: {}", e));
            return 1;
        }
    };
    reporter.info(&format!("{} artist(s) own releases whose files, under their own name, name a different MusicBrainz artist", found.len()));
    for (id, name, mbid) in &found {
        let ids = ids_by_release_count(pool, id).await.unwrap_or_default();
        let listed: Vec<String> = ids
            .iter()
            .map(|(m, n)| format!("{}{} x{}", &m[..8.min(m.len())], if Some(m) == mbid.as_ref() { " (row)" } else { "" }, n))
            .collect();
        reporter.nested().info(&format!("{} [{}]: {}", name, mbid.as_deref().map(|m| &m[..8.min(m.len())]).unwrap_or("no id"), listed.join(", ")));
    }
    if found.is_empty() {
        reporter.done("Nothing to split.");
        return 0;
    }
    if dry_run {
        reporter.blank();
        reporter.done("Dry run - nothing changed. Artists whose other ids turn out to be credits or mistags are left as they are by the real run.");
        return 0;
    }

    let ids: Vec<String> = found.iter().map(|(id, _, _)| id.clone()).collect();
    let bases_before = common::homonyms::bases_of(pool, &ids).await.unwrap_or_default();
    let releases: Vec<String> = match sqlx::query_scalar(r#"SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = ANY($1::text[])"#)
        .bind(&ids)
        .fetch_all(pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            reporter.err(&format!("Release query failed: {}", e));
            return 1;
        }
    };
    reporter.step(&format!("Re-deriving the owners of {} release(s)...", releases.len()));

    let mut resolver = ArtistResolver::new(pool, false);
    resolver.warm_cache().await;
    let mut report: Vec<Decision> = Vec::new();
    if let Err(e) = resolve_and_apply(pool, &mut resolver, Some(&releases), &mut report, Some(reporter)).await {
        reporter.err(&format!("Resolve pass failed: {}", e));
        return 1;
    }
    // The resolve pass reconciled the groups it touched; the names these artists had before are reconciled too, so a
    // group left with one member goes back to its bare slug.
    if let Err(e) = common::homonyms::reconcile_bases(pool, &bases_before).await {
        reporter.warn(&format!("Homonym reconcile failed: {}", e));
    }
    // Artists the re-derivation left owning nothing (an unidentified member whose releases all found their artist)
    // would only be an empty card on the chooser: the index's own orphan sweep removes them and reconciles again.
    let members: Vec<String> = sqlx::query_scalar(r#"SELECT id FROM "Artist" WHERE "baseSlug" = ANY($1::text[])"#)
        .bind(&bases_before)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    let swept = index::deletion::delete_orphan_artists(pool, config, Some(&members)).await;
    if swept > 0 {
        reporter.nested().ok(&format!("{} emptied artist(s) removed", swept));
    }

    let groups: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT "baseSlug", id, slug, NULLIF("musicbrainzId", '') FROM "Artist"
           WHERE "baseSlug" = ANY($1::text[]) AND "primaryArtistId" IS NULL ORDER BY 1, 3"#,
    )
    .bind(&bases_before)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut split = BTreeSet::new();
    for (base, _, _, _) in &groups {
        if groups.iter().filter(|(b, _, _, _)| b == base).count() > 1 {
            split.insert(base.clone());
        }
    }
    reporter.blank();
    for base in &split {
        let pages: Vec<String> = groups.iter().filter(|(b, _, _, _)| b == base).map(|(_, _, slug, _)| format!("/artist/{slug}")).collect();
        reporter.ok(&format!("{}: {}", base, pages.join(", ")));
    }
    let affected: Vec<String> = groups.iter().map(|(_, id, _, _)| id.clone()).collect();
    if let Some(path) = emit_ids {
        if let Err(e) = std::fs::write(path, affected.join("\n") + "\n") {
            reporter.err(&format!("Could not write {}: {}", path, e));
            return 1;
        }
        reporter.kv("Artist ids", path);
    }
    match common::homonyms::violations(pool).await {
        Ok(v) if v.is_empty() => {}
        Ok(v) => {
            for (base, reason) in v.iter().take(20) {
                reporter.warn(&format!("{}: {}", base, reason));
            }
        }
        Err(e) => reporter.warn(&format!("Invariant check failed: {}", e)),
    }
    reporter.done(&format!("{} name(s) now split into separate artists, {} artist(s) to re-sync", split.len(), affected.len()));
    0
}
