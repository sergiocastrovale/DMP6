//! Reconciling `Artist` rows with what MusicBrainz actually said.
//!
//! Three repairs, each with a guard that matters more than the repair itself:
//!   * a contradicted MBID is cleared - but never one `./sync` established;
//!   * a row is renamed to the canonical name - but never onto a name or slug someone else holds;
//!   * duplicates are connected - but only when MusicBrainz corroborates the pair, because
//!     `Artist.musicbrainzId` leaks onto compounds and merging on it alone folds a collaboration into
//!     its first member.
//!
//! `#[ignore]`d integration test - point it at a disposable, migrated Postgres, never production:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test canonicalize \
//!     -- --ignored --nocapture

use index::canonicalize::canonicalize_artists;
use sqlx::PgPool;

const SUFFIX: &str = "(canonicalize)";
const MBID_A: &str = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MBID_B: &str = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

struct Ctx {
    pool: PgPool,
}

impl Ctx {
    async fn new() -> Self {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
            "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
             against the production DATABASE_URL",
        );
        let ctx = Self {
            pool: common::db::create_pool(&db_url).await,
        };
        ctx.reset().await;
        ctx
    }

    /// The fixture marker goes at the END. `normalize_name` only strips a leading "the ", so a prefix
    /// would make `"The Chi-Lites"` and `"Chi-Lites"` normalize differently and quietly defeat the very
    /// guard these tests exercise.
    fn name(&self, s: &str) -> String {
        format!("{} {}", s, SUFFIX)
    }

    async fn reset(&self) {
        sqlx::query(r#"DELETE FROM "Artist" WHERE name LIKE $1"#)
            .bind(format!("%{}", SUFFIX))
            .execute(&self.pool)
            .await
            .expect("clear artists");
        sqlx::query(r#"DELETE FROM "MbArtistLookup" WHERE name LIKE $1"#)
            .bind(format!("%{}", SUFFIX))
            .execute(&self.pool)
            .await
            .expect("clear lookups");
    }

    /// An Artist row, optionally already carrying an MBID and/or a sync timestamp.
    async fn artist(&self, name: &str, mbid: Option<&str>, synced: bool) -> String {
        let id = common::db::ensure_artist(&self.pool, name)
            .await
            .expect("artist");
        sqlx::query(
            r#"UPDATE "Artist" SET "musicbrainzId" = $1,
                 "lastSyncedAt" = CASE WHEN $2 THEN now() ELSE NULL END
               WHERE id = $3"#,
        )
        .bind(mbid)
        .bind(synced)
        .bind(&id)
        .execute(&self.pool)
        .await
        .expect("seed artist");
        id
    }

    /// What MusicBrainz answered for a tag string: `Some((mbid, mbName))` or a definitive no.
    async fn lookup(&self, name: &str, answer: Option<(&str, &str)>) {
        sqlx::query(
            r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, "mbName", "checkedAt")
               VALUES ($1, $2, lower($2), $3, $4, now())
               ON CONFLICT (name) DO UPDATE SET mbid = EXCLUDED.mbid, "mbName" = EXCLUDED."mbName""#,
        )
        .bind(cuid2::create_id())
        .bind(name)
        .bind(answer.map(|(id, _)| id))
        .bind(answer.map(|(_, n)| n))
        .execute(&self.pool)
        .await
        .expect("insert lookup");
    }

    async fn row(&self, id: &str) -> (String, String, Option<String>, Option<String>) {
        sqlx::query_as(r#"SELECT name, slug, "musicbrainzId", "primaryArtistId" FROM "Artist" WHERE id = $1"#)
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .expect("artist row")
    }

    async fn own(&self, artist_id: &str, n: u32) {
        let release_id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
               VALUES ($1, 'Canonicalize Fixture', 2020, $2, $3, now(), now())"#,
        )
        .bind(&release_id)
        .bind(format!("folder:canonicalize-fixture/{}", release_id))
        .bind(format!("canonicalize-fixture/{}", release_id))
        .execute(&self.pool)
        .await
        .expect("insert release");
        sqlx::query(
            r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
               VALUES ($1, $2, $3, now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&release_id)
        .bind(artist_id)
        .execute(&self.pool)
        .await
        .expect("insert owner");
        let _ = n;
    }
}

#[tokio::test]
#[ignore]
async fn a_contradicted_mbid_is_cleared_unless_sync_established_it() {
    let c = Ctx::new().await;

    // MusicBrainz was asked about this exact string and said no, yet the row carries an id: a leak from
    // a span resolution, and the reason `Artist.musicbrainzId` cannot be a merge key.
    let leaked = c.name("Lena Horne & Guest").to_string();
    c.lookup(&leaked, None).await;
    let leaked_id = c.artist(&leaked, Some(MBID_A), false).await;

    // Same shape, but sync put the id there. Sync answers a different question (is this the artist I am
    // already committed to?) with a tolerant predicate, and its answer is not ours to overrule.
    let synced = c.name("Lena Horne & Synced").to_string();
    c.lookup(&synced, None).await;
    let synced_id = c.artist(&synced, Some(MBID_A), true).await;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    assert_eq!(c.row(&leaked_id).await.2, None, "leaked id should be cleared");
    assert_eq!(
        c.row(&synced_id).await.2,
        Some(MBID_A.to_string()),
        "an id sync established must survive"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn dry_run_writes_nothing() {
    let c = Ctx::new().await;
    let leaked = c.name("Dry Run Compound").to_string();
    c.lookup(&leaked, None).await;
    let id = c.artist(&leaked, Some(MBID_A), false).await;

    let (stats, report) = canonicalize_artists(&c.pool, None, true).await.expect("run");
    assert_eq!(stats.mbids_cleared, 1, "the dry run still counts the work");
    assert_eq!(report.mbids_cleared.len(), 1);
    assert_eq!(
        c.row(&id).await.2,
        Some(MBID_A.to_string()),
        "a dry run must not touch the row"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_punctuation_only_difference_renames_without_moving_the_slug() {
    let c = Ctx::new().await;

    // `\Jim Pepper` and `Jim Pepper` slugify identically, so `ensure_artist`'s ON CONFLICT (slug) made
    // them one row - stuck under whichever spelling was inserted first.
    let decorated = format!("\\{}", c.name("Jim Pepper"));
    let clean = c.name("Jim Pepper");
    c.lookup(&decorated, Some((MBID_A, &clean))).await;
    let id = c.artist(&decorated, None, false).await;
    let slug_before = c.row(&id).await.1;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    let (name, slug, _, _) = c.row(&id).await;
    assert_eq!(name, clean, "the row should take MusicBrainz's spelling");
    assert_eq!(slug, slug_before, "a punctuation-only fix must not move the URL");

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_rename_onto_a_taken_name_is_skipped_and_connected_instead() {
    let c = Ctx::new().await;

    // Two spellings of one MB artist, different slugs, so two rows exist. Renaming the second onto the
    // first's name would collide; connecting is the answer.
    let canonical = c.name("Iron & Wine");
    let variant = c.name("Iron And Wine");
    c.lookup(&canonical, Some((MBID_A, &canonical))).await;
    c.lookup(&variant, Some((MBID_A, &canonical))).await;

    let primary = c.artist(&canonical, None, false).await;
    c.own(&primary, 1).await;
    let dup = c.artist(&variant, None, false).await;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    let (dup_name, _, _, dup_primary) = c.row(&dup).await;
    assert_eq!(dup_name, variant, "the taken name must not be forced");
    assert_eq!(
        dup_primary,
        Some(primary.clone()),
        "the variant should be connected to the canonical row"
    );
    assert_eq!(
        c.row(&primary).await.3,
        None,
        "the primary must stay primary - no chains"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn the_owner_heavy_row_becomes_the_primary() {
    let c = Ctx::new().await;
    let canonical = c.name("Count Basie Orchestra");
    let variant = c.name("The Count Basie Orchestra");
    c.lookup(&canonical, Some((MBID_B, &canonical))).await;
    c.lookup(&variant, Some((MBID_B, &canonical))).await;

    // The row with the catalogue is created SECOND, so this fails if the pass just takes the first row.
    let thin = c.artist(&variant, None, false).await;
    let heavy = c.artist(&canonical, None, false).await;
    c.own(&heavy, 1).await;
    c.own(&heavy, 2).await;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    assert_eq!(
        c.row(&thin).await.3,
        Some(heavy.clone()),
        "the row holding the releases should be the primary"
    );
    assert_eq!(c.row(&heavy).await.3, None);

    c.reset().await;
}

/// `mb_artist_exact` also matches MusicBrainz **aliases**, so the lookup table legitimately reports
/// `"Simone" -> Nina Simone`, `"ANT" -> Adam Ant`, `"Lowe" -> Nick Lowe`. That is MB saying the string
/// *can* refer to that artist, not that it is their name - a library tagged `albumArtist = "Simone"`
/// usually means the Brazilian singer. Neither step may act on it.
#[tokio::test]
#[ignore]
async fn an_alias_hit_is_neither_renamed_nor_connected() {
    let c = Ctx::new().await;
    let full = c.name("Nina Simone");
    let alias = c.name("Simone");
    c.lookup(&full, Some((MBID_A, &full))).await;
    c.lookup(&alias, Some((MBID_A, &full))).await;

    let full_id = c.artist(&full, None, false).await;
    c.own(&full_id, 1).await;
    let alias_id = c.artist(&alias, None, false).await;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    let (alias_name, _, _, alias_primary) = c.row(&alias_id).await;
    assert_eq!(alias_name, alias, "an alias must not be renamed to the full name");
    assert_eq!(
        alias_primary, None,
        "an alias must not be connected - it is a different artist under a shared string"
    );

    c.reset().await;
}

/// The pairs the guard must still let through: same name, different punctuation.
#[tokio::test]
#[ignore]
async fn punctuation_and_ampersand_variants_still_connect() {
    let c = Ctx::new().await;
    for (i, (canonical, variant)) in [
        ("Fats Waller and His Rhythm", "Fats Waller & His Rhythm"),
        ("The Chi-Lites", "Chi-Lites"),
    ]
    .iter()
    .enumerate()
    {
        let canonical = c.name(canonical);
        let variant = c.name(variant);
        c.lookup(&canonical, Some((MBID_A, &canonical))).await;
        c.lookup(&variant, Some((MBID_A, &canonical))).await;
        let primary = c.artist(&canonical, None, false).await;
        c.own(&primary, i as u32).await;
        let dup = c.artist(&variant, None, false).await;

        canonicalize_artists(&c.pool, None, false).await.expect("run");

        assert_eq!(
            c.row(&dup).await.3,
            Some(primary),
            "{variant} should connect to {canonical}"
        );
        c.reset().await;
    }
}

/// `./index --only "X"` must stay about X. The artist page's rescan button issues exactly that, and an
/// unscoped pass would quietly rename ~1,300 unrelated artists behind a one-artist refresh.
#[tokio::test]
#[ignore]
async fn a_scoped_run_leaves_everything_outside_the_scope_alone() {
    let c = Ctx::new().await;

    let in_scope_tag = format!("\\{}", c.name("In Scope"));
    let in_scope_clean = c.name("In Scope");
    c.lookup(&in_scope_tag, Some((MBID_A, &in_scope_clean))).await;
    let in_scope = c.artist(&in_scope_tag, None, false).await;

    let out_tag = format!("\\{}", c.name("Out Of Scope"));
    let out_clean = c.name("Out Of Scope");
    c.lookup(&out_tag, Some((MBID_B, &out_clean))).await;
    let out_of_scope = c.artist(&out_tag, None, false).await;

    // A contradicted id on an out-of-scope row must survive too.
    let leaked = c.name("Out Of Scope Compound").to_string();
    c.lookup(&leaked, None).await;
    let leaked_id = c.artist(&leaked, Some(MBID_B), false).await;

    let scope = vec![in_scope.clone()];
    canonicalize_artists(&c.pool, Some(&scope), false)
        .await
        .expect("run");

    // Slug-stable, so a scoped run does make this one.
    assert_eq!(c.row(&in_scope).await.0, in_scope_clean, "the scoped row is fixed");
    assert_eq!(
        c.row(&out_of_scope).await.0,
        out_tag,
        "a row outside the scope must not be renamed"
    );
    assert_eq!(
        c.row(&leaked_id).await.2,
        Some(MBID_B.to_string()),
        "a contradicted id outside the scope must not be cleared"
    );

    c.reset().await;
}

/// A scoped run must not move a URL: the artist page issues `--only` and the user is sitting on
/// `/artist/<slug>` watching the terminal. The library-wide pass still does it.
#[tokio::test]
#[ignore]
async fn a_scoped_run_skips_a_rename_that_would_move_the_slug() {
    let c = Ctx::new().await;
    let tagged = c.name("Ink Spots");
    let canonical = c.name("The Ink Spots");
    c.lookup(&tagged, Some((MBID_A, &canonical))).await;
    let id = c.artist(&tagged, None, false).await;
    let slug_before = c.row(&id).await.1;

    let scope = vec![id.clone()];
    canonicalize_artists(&c.pool, Some(&scope), false)
        .await
        .expect("scoped run");
    let (name, slug, _, _) = c.row(&id).await;
    assert_eq!(name, tagged, "a scoped run must not relocate the artist page");
    assert_eq!(slug, slug_before);

    canonicalize_artists(&c.pool, None, false)
        .await
        .expect("library-wide run");
    let (name, slug, _, _) = c.row(&id).await;
    assert_eq!(name, canonical, "the library-wide pass still adopts the canonical name");
    assert_ne!(slug, slug_before, "and moves the slug with it");

    c.reset().await;
}

/// The one thing a scoped run must still reach outside its scope: the *twin* of an in-scope row. Being
/// out of scope is what makes it a duplicate, so filtering by artist id would leave the group looking
/// like a singleton and connect nothing.
#[tokio::test]
#[ignore]
async fn a_scoped_run_still_connects_an_out_of_scope_twin() {
    let c = Ctx::new().await;
    let canonical = c.name("The Bar-Kays");
    let variant = c.name("Bar-Kays");
    c.lookup(&canonical, Some((MBID_A, &canonical))).await;
    c.lookup(&variant, Some((MBID_A, &canonical))).await;

    let primary = c.artist(&canonical, None, false).await;
    c.own(&primary, 1).await;
    let dup = c.artist(&variant, None, false).await;

    // Only the duplicate is in scope; its primary is not.
    let scope = vec![dup.clone()];
    canonicalize_artists(&c.pool, Some(&scope), false)
        .await
        .expect("run");

    assert_eq!(
        c.row(&dup).await.3,
        Some(primary),
        "the twin must be found even though it is outside the scope"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_collaboration_is_never_folded_into_its_first_member() {
    let c = Ctx::new().await;

    // The exact live shape: the compound carries Lena Horne's MBID on the Artist row, but its lookup
    // row says MusicBrainz denied the string. Merging on the column alone would delete the
    // collaboration into the soloist.
    let solo = c.name("Lena Horne");
    let compound = c.name("Lena Horne & Gabor Szabo");
    c.lookup(&solo, Some((MBID_A, &solo))).await;
    c.lookup(&compound, None).await;

    let solo_id = c.artist(&solo, Some(MBID_A), false).await;
    let compound_id = c.artist(&compound, Some(MBID_A), false).await;

    canonicalize_artists(&c.pool, None, false).await.expect("run");

    assert_eq!(
        c.row(&compound_id).await.3,
        None,
        "an uncorroborated pair must never be connected"
    );
    assert_eq!(c.row(&solo_id).await.3, None);

    c.reset().await;
}
