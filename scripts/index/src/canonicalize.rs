//! Reconcile `Artist` rows with what MusicBrainz actually said, after the fact.
//!
//! Three defects share one cause: an Artist row is created from the *tag string*, once, and never
//! revisited. `common::db::ensure_artist` upserts `ON CONFLICT (slug) DO UPDATE SET "updatedAt"`, so
//! whoever inserted a slug first owns its spelling forever - and `make_slug` strips punctuation, which
//! means `"\Jim Pepper"` and `"Jim Pepper"` are the same row, stuck under the decorated name.
//!
//! | Symptom | Repair |
//! |---|---|
//! | A row carries an MBID its own lookup denies | clear it (step 1) |
//! | A row's name is not MusicBrainz's name | rename it (step 2) |
//! | Two rows are the same MB artist under different spellings | connect them (step 3) |
//!
//! All three run off `MbArtistLookup` - no network, no audio files, seconds on the live library. That
//! matters: a full re-index costs days, so every repair here has to be derivable from what the database
//! already knows.
//!
//! **`Artist.musicbrainzId` is not a safe merge key on its own.** 3,115 ids are shared by more than one
//! row, but the overwhelming majority are leaks: `"Lena Horne & Gábor Szabó"` carries Lena Horne's id
//! with zero links, and its `MbArtistLookup` row says `mbid IS NULL` - MusicBrainz was asked about that
//! exact string and said no. Merging on the column alone would fold collaborations into their first
//! member. Step 3 therefore requires **both** names to have a lookup row resolving to the same id,
//! which is MusicBrainz corroborating the pair rather than us inferring it.

use std::collections::HashMap;

use common::mb::names::normalize_name;
use common::slug::make_slug;
use sqlx::PgPool;

use crate::deletion::ArtistScope;

/// Two spellings of the same name, or two different names that happen to hit the same MB entity?
///
/// Sharing an MBID is not enough. `mb_artist_exact` also matches on MusicBrainz **aliases**, so the
/// lookup table legitimately reports `"Simone" -> Nina Simone`, `"ANT" -> Adam Ant`, `"Lowe" -> Nick
/// Lowe`. Those are MB saying "this string can refer to that artist", not "this is that artist's name" -
/// and a library where `albumArtist` is literally `"Simone"` usually means the Brazilian singer, not
/// Nina. Acting on them renames or hides a real artist.
///
/// So both steps below require the two spellings to **normalize to the same key**: same words, ignoring
/// case, punctuation, a leading "the", and `&` vs `and`. That keeps every variant pair worth fixing
/// (`Iron And Wine` / `Iron & Wine`, `Count Basie Orchestra` / `The Count Basie Orchestra`,
/// `Fats Waller & His Rhythm` / `Fats Waller and His Rhythm`, `\Jim Pepper` / `Jim Pepper`) and drops
/// every alias hit.
fn canonical_key(name: &str) -> String {
    normalize_name(&name.replace('&', " and "))
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CanonicalizeStats {
    pub mbids_cleared: u64,
    pub renamed: u64,
    pub connected: u64,
}

impl CanonicalizeStats {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// One rename the pass would make, for the dry-run report.
#[derive(Debug, Clone)]
pub struct Rename {
    pub from: String,
    pub to: String,
    pub slug_changes: bool,
}

/// One duplicate the pass would connect, for the dry-run report.
#[derive(Debug, Clone)]
pub struct Connection {
    pub duplicate: String,
    pub primary: String,
    pub mbid: String,
}

#[derive(Debug, Default)]
pub struct CanonicalizeReport {
    pub renames: Vec<Rename>,
    pub connections: Vec<Connection>,
    pub mbids_cleared: Vec<String>,
}

/// Step 1 - drop MBIDs that the lookup table contradicts.
///
/// Scoped to `lastSyncedAt IS NULL` so an id `./sync` established is never touched: sync matches with a
/// tolerant predicate against an artist it is already committed to, which is a different (and valid)
/// question from "is this exact string an artist". Only the resolver's own leaks are cleared, and the
/// next resolve pass re-derives them correctly.
async fn clear_contradicted_mbids(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    dry_run: bool,
    report: &mut CanonicalizeReport,
) -> Result<u64, sqlx::Error> {
    const SELECT: &str = r#"SELECT a.id, a.name FROM "Artist" a
           JOIN "MbArtistLookup" m ON m.name = a.name
           WHERE m.mbid IS NULL
             AND a."musicbrainzId" IS NOT NULL
             AND a."lastSyncedAt" IS NULL
             AND ($2::bool OR a.id = ANY($1::text[]))"#;

    let rows: Vec<(String, String)> = sqlx::query_as(SELECT)
        .bind(scope.unwrap_or(&[]))
        .bind(scope.is_none())
        .fetch_all(pool)
        .await?;
    if rows.is_empty() {
        return Ok(0);
    }
    report.mbids_cleared = rows.iter().map(|(_, name)| name.clone()).collect();
    if dry_run {
        return Ok(rows.len() as u64);
    }

    let ids: Vec<String> = rows.into_iter().map(|(id, _)| id).collect();
    let result = sqlx::query(
        r#"UPDATE "Artist" SET "musicbrainzId" = NULL, "updatedAt" = NOW()
           WHERE id = ANY($1::text[])"#,
    )
    .bind(&ids)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Step 2 - adopt MusicBrainz's spelling.
///
/// Two cases, both safe:
///   * the canonical name slugifies to the row's existing slug (`"\Jim Pepper"` -> `"Jim Pepper"`,
///     `"Rex Allen Jr."` -> `"Rex Allen, Jr."`, `'` -> `’`): a pure display fix, no URL changes;
///   * the canonical slug is free: rename both fields.
///
/// A taken name or slug is left alone - that pair is a duplicate, and step 3 connects it instead.
async fn rename_to_canonical(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    dry_run: bool,
    report: &mut CanonicalizeReport,
) -> Result<u64, sqlx::Error> {
    let candidates: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT a.id, a.name, a.slug, m."mbName" FROM "Artist" a
           JOIN "MbArtistLookup" m ON m.name = a.name
           WHERE m."mbName" IS NOT NULL AND m."mbName" <> a.name
             AND ($2::bool OR a.id = ANY($1::text[]))
           ORDER BY a.name"#,
    )
    .bind(scope.unwrap_or(&[]))
    .bind(scope.is_none())
    .fetch_all(pool)
    .await?;
    if candidates.is_empty() {
        return Ok(0);
    }

    // One query instead of a round trip per candidate: which names/slugs are already spoken for.
    let taken_rows: Vec<(String, String, String)> =
        sqlx::query_as(r#"SELECT id, name, slug FROM "Artist""#)
            .fetch_all(pool)
            .await?;
    let mut by_name: HashMap<&str, &str> = HashMap::new();
    let mut by_slug: HashMap<&str, &str> = HashMap::new();
    for (id, name, slug) in &taken_rows {
        by_name.insert(name.as_str(), id.as_str());
        by_slug.insert(slug.as_str(), id.as_str());
    }

    let mut renamed = 0u64;
    for (id, name, slug, mb_name) in &candidates {
        let target_slug = make_slug(mb_name);
        if target_slug.is_empty() {
            continue;
        }
        // Only a spelling fix, never a different name that MB happens to alias (`"ANT"` must not
        // become `"Adam Ant"`).
        if canonical_key(name) != canonical_key(mb_name) {
            continue;
        }
        let name_free = by_name.get(mb_name.as_str()).is_none_or(|owner| *owner == id);
        let slug_free = by_slug
            .get(target_slug.as_str())
            .is_none_or(|owner| *owner == id);
        if !name_free || !slug_free {
            continue;
        }
        // A scoped run only makes renames that keep the slug. The artist page's rescan button issues
        // `--only <folders>` and the user watches the terminal on `/artist/<slug>` while it runs -
        // moving that URL out from under them mid-scan is not a targeted change. Punctuation-only fixes
        // (`\Jim Pepper` -> `Jim Pepper`) still land, because they slugify identically; a rename that
        // relocates the page waits for the library-wide pass, which is a deliberate maintenance action.
        let slug_changes = &target_slug != slug;
        if slug_changes && scope.is_some() {
            continue;
        }

        report.renames.push(Rename {
            from: name.clone(),
            to: mb_name.clone(),
            slug_changes,
        });
        if dry_run {
            renamed += 1;
            continue;
        }
        sqlx::query(r#"UPDATE "Artist" SET name = $1, slug = $2, "updatedAt" = NOW() WHERE id = $3"#)
            .bind(mb_name)
            .bind(&target_slug)
            .bind(id)
            .execute(pool)
            .await?;
        renamed += 1;
    }
    Ok(renamed)
}

/// Step 3 - connect duplicate spellings of one MB artist.
///
/// Sets `primaryArtistId`, the model the rest of the app already understands: the connected row drops
/// out of `/browse` and its catalogue is aggregated onto the primary's page. Deliberately **not** a
/// delete - folding two rows into one is destructive and belongs to `./fix --duplicates`, which has the
/// genre/URL/playcount merge logic and an undo trail.
///
/// The primary is the row with the most `LocalReleaseArtist` links - the one whose page already has a
/// catalogue, so browse and the per-row totals stay where the releases are. Ties go to the row spelled
/// the way MusicBrainz spells it, then to `createdAt`, so the choice is stable across runs.
async fn connect_corroborated_duplicates(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    dry_run: bool,
    report: &mut CanonicalizeReport,
) -> Result<u64, sqlx::Error> {
    // Both names must have their own lookup row pointing at the same MBID. That is MusicBrainz saying
    // "these two strings are this artist", not us inferring it from a column that leaks.
    //
    // A scoped run narrows by **MBID**, not by artist id: the twin of an in-scope row is usually out of
    // scope (that is what makes it a duplicate), and filtering it out would leave the group looking like
    // a singleton and connect nothing.
    let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
        r#"SELECT m.mbid, a.id, a.name,
                  (SELECT count(*) FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id) AS owns
           FROM "Artist" a
           JOIN "MbArtistLookup" m ON m.name = a.name
           WHERE m.mbid IS NOT NULL AND a."primaryArtistId" IS NULL
             AND ($2::bool OR m.mbid IN (
                   SELECT m2.mbid FROM "Artist" a2
                   JOIN "MbArtistLookup" m2 ON m2.name = a2.name
                   WHERE a2.id = ANY($1::text[]) AND m2.mbid IS NOT NULL))
           ORDER BY m.mbid, owns DESC, (a.name = m."mbName") DESC, a."createdAt", a.id"#,
    )
    .bind(scope.unwrap_or(&[]))
    .bind(scope.is_none())
    .fetch_all(pool)
    .await?;

    // Keyed on (mbid, normalized name), not mbid alone: same entity AND same name, so an alias hit like
    // "Simone" never gets folded into "Nina Simone".
    let mut groups: HashMap<(String, String), Vec<(String, String)>> = HashMap::new();
    for (mbid, id, name, _owns) in rows {
        let key = (mbid, canonical_key(&name));
        groups.entry(key).or_default().push((id, name));
    }

    let mut connected = 0u64;
    for ((mbid, _key), members) in groups {
        if members.len() < 2 {
            continue;
        }
        let (primary_id, primary_name) = &members[0];
        for (dup_id, dup_name) in &members[1..] {
            report.connections.push(Connection {
                duplicate: dup_name.clone(),
                primary: primary_name.clone(),
                mbid: mbid.clone(),
            });
            if dry_run {
                connected += 1;
                continue;
            }
            // `IS NULL` guard: never re-point a row another run already connected, and never build a
            // chain (the web app resolves exactly one hop).
            let result = sqlx::query(
                r#"UPDATE "Artist" SET "primaryArtistId" = $1, "updatedAt" = NOW()
                   WHERE id = $2 AND "primaryArtistId" IS NULL
                     AND NOT EXISTS (SELECT 1 FROM "Artist" p WHERE p.id = $1 AND p."primaryArtistId" IS NOT NULL)"#,
            )
            .bind(primary_id)
            .bind(dup_id)
            .execute(pool)
            .await?;
            connected += result.rows_affected();
        }
    }
    Ok(connected)
}

/// Run all three steps in order. Clearing comes first so a contradicted id cannot survive into the
/// merge, and renaming comes before connecting so the primary is already canonically named.
///
/// `scope` is `None` for the whole library and `Some(artist_ids)` for a filtered run - the same
/// `ArtistScope` discipline the deletion sweeps use, and for the same reason. `./index --only "X"` must
/// not quietly rename 1,295 unrelated artists and connect 108 unrelated pairs; the artist page's rescan
/// button issues exactly that command.
pub async fn canonicalize_artists(
    pool: &PgPool,
    scope: ArtistScope<'_>,
    dry_run: bool,
) -> Result<(CanonicalizeStats, CanonicalizeReport), sqlx::Error> {
    let mut report = CanonicalizeReport::default();
    let stats = CanonicalizeStats {
        mbids_cleared: clear_contradicted_mbids(pool, scope, dry_run, &mut report).await?,
        renamed: rename_to_canonical(pool, scope, dry_run, &mut report).await?,
        connected: connect_corroborated_duplicates(pool, scope, dry_run, &mut report).await?,
    };
    Ok((stats, report))
}
