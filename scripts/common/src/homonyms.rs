//! Two artists, one name (docs/sync_decisions.md "Two artists, one name").
//!
//! An artist's identity is its MusicBrainz id, not its name. Rows whose names slugify alike share a
//! `baseSlug` and form a *homonym group*. The flows that create, identify, rename, connect or delete artist
//! rows (index, sync, add, delete, tidy, fix) only change those facts; the group's slugs and merges are then
//! derived in one place, [`reconcile_group`], so no flow can leave a group half-updated and the order the
//! flows run in never changes the result.
//!
//! The invariant `reconcile_group` keeps, per base slug, over primary rows (`primaryArtistId IS NULL`):
//!   1. one member   -> it holds the bare slug (`napa`);
//!   2. two or more  -> each holds `{base}-{first 8 of its MB id}` (`napa-d76eeba7`), or of its Artist id when it
//!      has no MB id, growing on a clash; nobody holds the bare slug - it is the web app's chooser page;
//!   3. at most one member without an MB id (the group's *unidentified* member);
//!   4. no two members with the same MB id;
//!   5. in a group of two or more, every release sits with the member its files' ids name, else the one member
//!      whose synced catalogue holds it, else the unidentified member - so a release placed while its name still
//!      had one artist is re-homed the moment a second one appears, whichever flow brought it.
//!
//! 3 and 4 are enforced by connecting the extra rows to the survivor (`primaryArtistId`), the same way every
//! other duplicate artist is connected, so nothing is deleted and the web app already aggregates them. Every
//! slug that changes leaves an `ArtistSlugHistory` row so its old URL redirects.
//!
//! The suffix is an id, never a country: a folder can bind some releases to one artist and carry another
//! artist's id whose MusicBrainz entry has no country, or one sync has not reached yet. An id is known the
//! moment the tags are read, is unique, and gives the same slug after a rebuild.

use std::collections::{HashMap, HashSet};

use sqlx::{PgPool, Postgres, Transaction};
use unicode_normalization::UnicodeNormalization;

use crate::mb::names::normalize_name;
use crate::slug::make_slug;

/// How the caller came to know the MusicBrainz id it passes, which decides how far the id is trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdSource {
    /// Read from the files' own tags, confirmed by the certainty gate, or proven by sync / `./add` / an explicit
    /// assignment. Enough to create a separate artist even when the name is already taken by another id.
    Proven,
    /// A name search's answer. Only trusted while the name is unambiguous and the group has one member at most:
    /// it may fill or identify that member, never create a homonym.
    Search,
}

/// What `ensure_artist_identity` needs to know about one owner or credit.
#[derive(Debug, Clone)]
pub struct IdentityRequest<'a> {
    pub name: &'a str,
    pub mbid: Option<&'a str>,
    pub source: IdSource,
    /// The release this identity is being resolved for, when it is an owner. A release with no usable id in a
    /// group of two or more goes to the one member whose synced catalogue contains this title.
    pub release_title: Option<&'a str>,
    /// A credit (TrackRelatedArtist) rather than an owner. A credit with no id is dropped in a group of two or
    /// more instead of being attached to a guessed member.
    pub credit: bool,
}

/// Per-run state for identity resolution: which base slugs were touched (so the caller reconciles exactly
/// those), and a cache for the answers that do not depend on the release.
#[derive(Default)]
pub struct IdentityState {
    touched: HashSet<String>,
    by_id: HashMap<(String, String), String>,
    ambiguous: HashMap<String, bool>,
}

impl IdentityState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The base slugs any call touched, for [`reconcile_touched`].
    pub fn touched(&self) -> Vec<String> {
        let mut v: Vec<String> = self.touched.iter().cloned().collect();
        v.sort();
        v
    }

    pub fn touch(&mut self, base: &str) {
        if !base.is_empty() {
            self.touched.insert(base.to_string());
        }
    }

    /// Forget cached answers - after a reconcile merged or created rows.
    pub fn clear_cache(&mut self) {
        self.by_id.clear();
    }
}

/// The slug a member of a group of two or more carries: `{base}-{token}`, where the token is the first 8
/// characters of its MusicBrainz id (hyphens removed) or, for the unidentified member, of its Artist id. The
/// token grows to 12, 16, then its full length when a shorter form is already taken.
pub fn homonym_slug(
    base: &str,
    mbid: Option<&str>,
    artist_id: &str,
    taken: &HashSet<String>,
) -> String {
    let token: String = mbid
        .filter(|m| !m.trim().is_empty())
        .unwrap_or(artist_id)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    let token = if token.is_empty() {
        make_slug(artist_id)
    } else {
        token
    };
    for len in [8usize, 12, 16] {
        if token.len() <= len {
            break;
        }
        let candidate = format!("{}-{}", base, &token[..len]);
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    let full = format!("{}-{}", base, token);
    if !taken.contains(&full) {
        return full;
    }
    // Only reachable if the full token itself collides - an Artist id is unique, so append it.
    format!("{}-{}", full, make_slug(artist_id))
}

/// Lowercased alphanumerics with accents folded - enough to recognise "Logo Se Vê" and "Logo se ve" as one
/// album title for the catalogue-evidence rule.
pub fn normalize_title(title: &str) -> String {
    title
        .nfkd()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[derive(Debug, Clone)]
struct Member {
    id: String,
    mbid: Option<String>,
}

async fn primaries(pool: &PgPool, base: &str) -> Result<Vec<Member>, sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT a.id, NULLIF(a."musicbrainzId", '')
           FROM "Artist" a
           WHERE a."baseSlug" = $1 AND a."primaryArtistId" IS NULL
           ORDER BY a.id"#,
    )
    .bind(base)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, mbid)| Member { id, mbid })
        .collect())
}

/// Whether MusicBrainz answers to this name with more than one artist, as recorded by the resolver.
async fn name_is_ambiguous(pool: &PgPool, state: &mut IdentityState, name: &str) -> bool {
    let key = normalize_name(name);
    if let Some(v) = state.ambiguous.get(&key) {
        return *v;
    }
    let v: bool = sqlx::query_scalar(
        r#"SELECT COALESCE(bool_or(ambiguous), false) FROM "MbArtistLookup" WHERE normalized = $1"#,
    )
    .bind(&key)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    state.ambiguous.insert(key, v);
    v
}

/// The one member whose synced MusicBrainz catalogue contains `title`, if exactly one does.
async fn member_by_catalogue(pool: &PgPool, members: &[Member], title: &str) -> Option<String> {
    let wanted = normalize_title(title);
    if wanted.is_empty() {
        return None;
    }
    let ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT DISTINCT mra."artistId", mr.title
           FROM "MusicBrainzReleaseArtist" mra
           JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
           WHERE mra."artistId" = ANY($1::text[])"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let hits: HashSet<String> = rows
        .into_iter()
        .filter(|(_, t)| normalize_title(t) == wanted)
        .map(|(a, _)| a)
        .collect();
    (hits.len() == 1).then(|| hits.into_iter().next().unwrap())
}

async fn insert_artist(
    pool: &PgPool,
    name: &str,
    slug: &str,
    base: &str,
    mbid: Option<&str>,
) -> Result<String, sqlx::Error> {
    let id = cuid2::create_id();
    let row: (String,) = sqlx::query_as(
        r#"INSERT INTO "Artist" (id, name, slug, "baseSlug", "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 0, 0, NOW(), NOW())
           ON CONFLICT (slug) DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
           RETURNING id"#,
    )
    .bind(&id)
    .bind(name)
    .bind(slug)
    .bind(base)
    .bind(mbid)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// A slug nobody holds yet for a new member of `base`'s group - provisional; `reconcile_group` settles it.
async fn fresh_member_slug(
    pool: &PgPool,
    base: &str,
    mbid: Option<&str>,
    artist_id: &str,
) -> Result<String, sqlx::Error> {
    let like = format!("{}-%", base);
    let taken: HashSet<String> = sqlx::query_scalar::<_, String>(
        r#"SELECT slug FROM "Artist" WHERE slug = $1 OR slug LIKE $2"#,
    )
    .bind(base)
    .bind(&like)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    Ok(homonym_slug(base, mbid, artist_id, &taken))
}

/// Create a new member of `base`'s group, with a provisional slug that never takes the bare one when the group
/// already has members.
async fn create_member(
    pool: &PgPool,
    name: &str,
    base: &str,
    mbid: Option<&str>,
    group_empty: bool,
) -> Result<String, sqlx::Error> {
    if group_empty {
        let bare_free: bool =
            sqlx::query_scalar(r#"SELECT NOT EXISTS (SELECT 1 FROM "Artist" WHERE slug = $1)"#)
                .bind(base)
                .fetch_one(pool)
                .await?;
        if bare_free {
            return insert_artist(pool, name, base, base, mbid).await;
        }
    }
    let provisional_id = cuid2::create_id();
    let slug = fresh_member_slug(pool, base, mbid, &provisional_id).await?;
    insert_artist(pool, name, &slug, base, mbid).await
}

/// The artist row an owner or credit belongs to - creating it when needed - following the identity rules. Returns
/// an empty string when there is nothing to attach (an empty name, or a credit that cannot be placed without a
/// guess). The caller calls [`reconcile_touched`] once its batch is written.
pub async fn ensure_artist_identity(
    pool: &PgPool,
    state: &mut IdentityState,
    req: &IdentityRequest<'_>,
) -> Result<String, sqlx::Error> {
    let base = make_slug(req.name);
    if base.is_empty() {
        return Ok(String::new());
    }
    state.touch(&base);
    let mbid = req.mbid.map(str::trim).filter(|m| !m.is_empty());

    if let Some(id) = mbid {
        if let Some(hit) = state.by_id.get(&(base.clone(), id.to_string())) {
            return Ok(hit.clone());
        }
    }

    let members = primaries(pool, &base).await?;
    let ambiguous = name_is_ambiguous(pool, state, req.name).await;
    // A search's id is only as good as the name it was searched by.
    let (mbid, proven) = match (mbid, req.source) {
        (Some(id), IdSource::Proven) => (Some(id), true),
        (Some(id), IdSource::Search) if !ambiguous && members.len() <= 1 => (Some(id), false),
        _ => (None, false),
    };

    let chosen = match mbid {
        Some(id) => {
            if let Some(m) = members.iter().find(|m| m.mbid.as_deref() == Some(id)) {
                m.id.clone()
            } else if members.is_empty() {
                create_member(pool, req.name, &base, Some(id), true).await?
            } else if members.len() == 1 && (members[0].mbid.is_none() || !proven) && !ambiguous {
                // The name's only artist, not yet identified (or identified by an earlier search): this is who
                // it is. The same fill index always did; a search never overwrites a proven id - `members.len() <= 1`
                // above plus this branch only replaces an id that a previous search wrote.
                let only = &members[0];
                sqlx::query(r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#)
                    .bind(id)
                    .bind(&only.id)
                    .execute(pool)
                    .await?;
                only.id.clone()
            } else if proven {
                // A second MusicBrainz artist with this name: its own row. The group forms at reconcile.
                create_member(pool, req.name, &base, Some(id), false).await?
            } else {
                String::new()
            }
        }
        None => {
            if members.is_empty() {
                create_member(pool, req.name, &base, None, true).await?
            } else if members.len() == 1 {
                members[0].id.clone()
            } else if req.credit {
                // Several artists by this name and nothing saying which one is meant.
                return Ok(String::new());
            } else if let Some(hit) = match req.release_title {
                Some(title) => member_by_catalogue(pool, &members, title).await,
                None => None,
            } {
                hit
            } else if let Some(unidentified) = members.iter().find(|m| m.mbid.is_none()) {
                unidentified.id.clone()
            } else {
                // The home for "an artist by this name we cannot identify yet".
                create_member(pool, req.name, &base, None, false).await?
            }
        }
    };

    if let (Some(id), false) = (mbid, chosen.is_empty()) {
        state.by_id.insert((base, id.to_string()), chosen.clone());
    }
    Ok(chosen)
}

/// What a reconcile changed, for the caller's report.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ReconcileOutcome {
    /// (artist id, old slug, new slug)
    pub renamed: Vec<(String, String, String)>,
    /// (connected artist id, survivor id)
    pub connected: Vec<(String, String)>,
    /// (release id, from artist id, to artist id)
    pub moved: Vec<(String, String, String)>,
}

impl ReconcileOutcome {
    pub fn is_empty(&self) -> bool {
        self.renamed.is_empty() && self.connected.is_empty() && self.moved.is_empty()
    }

    fn absorb(&mut self, other: ReconcileOutcome) {
        self.renamed.extend(other.renamed);
        self.connected.extend(other.connected);
        self.moved.extend(other.moved);
    }
}

/// One release owned by a member of a group of two or more, with the evidence about whose it is.
#[derive(Debug, Clone)]
struct OwnedRelease {
    link_id: String,
    release_id: String,
    owner: String,
    /// Every MusicBrainz artist id its files carry (album-artist and artist frames).
    file_ids: HashSet<String>,
    /// Members whose synced catalogue holds this release (its bound MB release, or its title).
    catalogue_members: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Home {
    Keep,
    Move(String),
    ToUnidentified,
}

/// Rule 5 - where a release of a group of two or more belongs. Pure. In order: the member whose MB id its own
/// files carry; else the one member whose catalogue holds it; else the group's unidentified member. The same
/// evidence the index applies when it places a release (`ensure_artist_identity`), applied again here so that a
/// release placed before its name had a second artist ends up where it would have if the order had been reversed.
fn home_of(release: &OwnedRelease, members: &[(String, Option<String>)]) -> Home {
    let mut proven: Vec<&String> = members
        .iter()
        .filter(|(_, mbid)| mbid.as_ref().is_some_and(|m| release.file_ids.contains(m)))
        .map(|(id, _)| id)
        .collect();
    proven.sort();
    if !proven.is_empty() {
        return if proven.contains(&&release.owner) {
            Home::Keep
        } else {
            Home::Move(proven[0].clone())
        };
    }
    let evidence: Vec<&String> = members
        .iter()
        .map(|(id, _)| id)
        .filter(|id| release.catalogue_members.contains(*id))
        .collect();
    if evidence.len() == 1 {
        return if *evidence[0] == release.owner {
            Home::Keep
        } else {
            Home::Move(evidence[0].clone())
        };
    }
    let owner_unidentified = members
        .iter()
        .any(|(id, mbid)| *id == release.owner && mbid.is_none());
    if owner_unidentified {
        Home::Keep
    } else {
        Home::ToUnidentified
    }
}

async fn owned_releases(
    tx: &mut Transaction<'_, Postgres>,
    member_ids: &[String],
) -> Result<Vec<OwnedRelease>, sqlx::Error> {
    // (link id, release id, owner, ids its files carry, title, bound MB release)
    type Row = (String, String, String, Vec<String>, String, Option<String>);
    let rows: Vec<Row> = sqlx::query_as(
        r#"SELECT lra.id, lr.id, lra."artistId",
                  ARRAY(SELECT DISTINCT x FROM "LocalReleaseTrack" t,
                          unnest(COALESCE(t."mbAlbumArtistIds", '{}') || COALESCE(t."mbArtistIds", '{}')
                                 || CASE WHEN t."mbAlbumArtistId" IS NULL THEN '{}'::text[] ELSE ARRAY[t."mbAlbumArtistId"] END) x
                        WHERE t."localReleaseId" = lr.id),
                  lr.title, lr."releaseId"
           FROM "LocalReleaseArtist" lra JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
           WHERE lra."artistId" = ANY($1::text[])
           ORDER BY lr.id, lra."artistId""#,
    )
    .bind(member_ids)
    .fetch_all(&mut **tx)
    .await?;

    let catalogue: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT mra."artistId", mr.id, mr.title FROM "MusicBrainzReleaseArtist" mra
           JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
           WHERE mra."artistId" = ANY($1::text[])"#,
    )
    .bind(member_ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut by_release: HashMap<String, HashSet<String>> = HashMap::new();
    let mut by_title: HashMap<String, HashSet<String>> = HashMap::new();
    for (artist, release, title) in catalogue {
        by_release
            .entry(release)
            .or_default()
            .insert(artist.clone());
        by_title
            .entry(normalize_title(&title))
            .or_default()
            .insert(artist);
    }

    Ok(rows
        .into_iter()
        .map(|(link_id, release_id, owner, ids, title, bound)| {
            let mut catalogue_members: HashSet<String> = HashSet::new();
            if let Some(b) = bound.and_then(|b| by_release.get(&b).cloned()) {
                catalogue_members.extend(b);
            }
            let t = normalize_title(&title);
            if !t.is_empty() {
                if let Some(m) = by_title.get(&t) {
                    catalogue_members.extend(m.iter().cloned());
                }
            }
            OwnedRelease {
                link_id,
                release_id,
                owner,
                file_ids: ids
                    .into_iter()
                    .filter_map(|i| crate::filters::sanitize_mb_id(&i))
                    .collect(),
                catalogue_members,
            }
        })
        .collect())
}

/// Rule 5 applied: moves each release of a group of two or more to the member the evidence names, creating the
/// group's unidentified member when a release needs it. Returns whether the group's rows changed.
async fn rehome_releases(
    tx: &mut Transaction<'_, Postgres>,
    base: &str,
    rows: &[GroupRow],
    outcome: &mut ReconcileOutcome,
) -> Result<bool, sqlx::Error> {
    let primaries: Vec<&GroupRow> = rows.iter().filter(|r| r.primary.is_none()).collect();
    if primaries.len() < 2 {
        return Ok(false);
    }
    let mut members: Vec<(String, Option<String>)> = primaries
        .iter()
        .map(|p| (p.id.clone(), p.mbid.clone()))
        .collect();
    let ids: Vec<String> = members.iter().map(|(id, _)| id.clone()).collect();
    let releases = owned_releases(tx, &ids).await?;

    let mut created = false;
    let mut unidentified: Option<String> = members
        .iter()
        .find(|(_, m)| m.is_none())
        .map(|(id, _)| id.clone());
    for release in &releases {
        let target = match home_of(release, &members) {
            Home::Keep => continue,
            Home::Move(to) => to,
            Home::ToUnidentified => match &unidentified {
                Some(id) => id.clone(),
                None => {
                    let name = rows
                        .iter()
                        .find(|r| r.id == release.owner)
                        .map(|r| r.name.clone())
                        .unwrap_or_default();
                    let id = cuid2::create_id();
                    sqlx::query(
                        r#"INSERT INTO "Artist" (id, name, slug, "baseSlug", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
                           VALUES ($1, $2, $3, $4, 0, 0, NOW(), NOW())"#,
                    )
                    .bind(&id)
                    .bind(&name)
                    .bind(format!("__homonym-{}", id))
                    .bind(base)
                    .execute(&mut **tx)
                    .await?;
                    members.push((id.clone(), None));
                    unidentified = Some(id.clone());
                    created = true;
                    id
                }
            },
        };
        let already: bool = sqlx::query_scalar(
            r#"SELECT EXISTS (SELECT 1 FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1 AND "artistId" = $2)"#,
        )
        .bind(&release.release_id)
        .bind(&target)
        .fetch_one(&mut **tx)
        .await?;
        if already {
            sqlx::query(r#"DELETE FROM "LocalReleaseArtist" WHERE id = $1"#)
                .bind(&release.link_id)
                .execute(&mut **tx)
                .await?;
        } else {
            sqlx::query(r#"UPDATE "LocalReleaseArtist" SET "artistId" = $1 WHERE id = $2"#)
                .bind(&target)
                .bind(&release.link_id)
                .execute(&mut **tx)
                .await?;
        }
        // Sync only looks at artists stamped as indexed since their last sync.
        sqlx::query(
            r#"UPDATE "Artist" SET "lastIndexedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1"#,
        )
        .bind(&target)
        .execute(&mut **tx)
        .await?;
        outcome
            .moved
            .push((release.release_id.clone(), release.owner.clone(), target));
    }
    Ok(created)
}

#[derive(Debug, Clone)]
struct GroupRow {
    id: String,
    name: String,
    slug: String,
    mbid: Option<String>,
    primary: Option<String>,
    owned: i64,
}

/// Survivor order among rows that are one artist: most owned releases, then lowest id - stable across runs.
fn survivor<'a>(rows: &[&'a GroupRow]) -> &'a GroupRow {
    rows.iter()
        .copied()
        .max_by(|a, b| a.owned.cmp(&b.owned).then_with(|| b.id.cmp(&a.id)))
        .expect("non-empty")
}

/// The slug every row of one group should hold, given the slugs held outside the group. Pure, so the rules are
/// unit-testable without a database.
fn desired_slugs(
    base: &str,
    rows: &[GroupRow],
    outside: &HashSet<String>,
) -> HashMap<String, String> {
    let mut desired: HashMap<String, String> = HashMap::new();
    let primaries: Vec<&GroupRow> = rows.iter().filter(|r| r.primary.is_none()).collect();
    let mut taken: HashSet<String> = outside.clone();

    if primaries.len() == 1 {
        let only = primaries[0];
        let slug = if outside.contains(base) {
            only.slug.clone()
        } else {
            base.to_string()
        };
        taken.insert(slug.clone());
        desired.insert(only.id.clone(), slug);
    } else if primaries.len() > 1 {
        // The bare slug is the chooser page's; nobody may hold it.
        taken.insert(base.to_string());
        let mut ordered = primaries.clone();
        ordered.sort_by(|a, b| a.id.cmp(&b.id));
        for p in ordered {
            let slug = homonym_slug(base, p.mbid.as_deref(), &p.id, &taken);
            taken.insert(slug.clone());
            desired.insert(p.id.clone(), slug);
        }
    }

    // Connected rows keep whatever slug they have unless a primary needs it (or it is the bare slug of a group
    // of two or more); then they get an id-suffixed one of their own.
    let mut connected: Vec<&GroupRow> = rows.iter().filter(|r| r.primary.is_some()).collect();
    connected.sort_by(|a, b| a.id.cmp(&b.id));
    for c in connected {
        let clashes = taken.contains(&c.slug) || (primaries.len() > 1 && c.slug == base);
        let slug = if clashes {
            homonym_slug(base, None, &c.id, &taken)
        } else {
            c.slug.clone()
        };
        taken.insert(slug.clone());
        desired.insert(c.id.clone(), slug);
    }
    desired
}

/// Which rows of a group must be connected to which survivor: rule 4 (same MB id) and rule 3 (a second
/// unidentified member). Pure.
fn connections(rows: &[GroupRow]) -> Vec<(String, String)> {
    let primaries: Vec<&GroupRow> = rows.iter().filter(|r| r.primary.is_none()).collect();
    let mut buckets: HashMap<Option<String>, Vec<&GroupRow>> = HashMap::new();
    for p in primaries {
        buckets.entry(p.mbid.clone()).or_default().push(p);
    }
    let mut out = Vec::new();
    let mut keys: Vec<&Option<String>> = buckets.keys().collect();
    keys.sort();
    for key in keys {
        let bucket = &buckets[key];
        if bucket.len() < 2 {
            continue;
        }
        let keep = survivor(bucket);
        let mut losers: Vec<&GroupRow> =
            bucket.iter().copied().filter(|r| r.id != keep.id).collect();
        losers.sort_by(|a, b| a.id.cmp(&b.id));
        for l in losers {
            out.push((l.id.clone(), keep.id.clone()));
        }
    }
    out
}

async fn load_group(
    tx: &mut Transaction<'_, Postgres>,
    base: &str,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    // (id, name, slug, MB id, primary, owned releases)
    type Row = (String, String, String, Option<String>, Option<String>, i64);
    let rows: Vec<Row> = sqlx::query_as(
        r#"SELECT a.id, a.name, a.slug, NULLIF(a."musicbrainzId", ''), a."primaryArtistId",
                  (SELECT count(*) FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id)
           FROM "Artist" a WHERE a."baseSlug" = $1 ORDER BY a.id
           FOR UPDATE"#,
    )
    .bind(base)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, slug, mbid, primary, owned)| GroupRow {
            id,
            name,
            slug,
            mbid,
            primary,
            owned,
        })
        .collect())
}

/// Bring one base slug's group to the invariant (module doc). Idempotent: a group already in shape changes
/// nothing. Runs in its own transaction; callers hold the scan lock, so groups are never reconciled concurrently.
pub async fn reconcile_group(pool: &PgPool, base: &str) -> Result<ReconcileOutcome, sqlx::Error> {
    let mut outcome = ReconcileOutcome::default();
    if base.is_empty() {
        return Ok(outcome);
    }
    let mut tx = pool.begin().await?;
    let mut rows = load_group(&mut tx, base).await?;
    if rows.is_empty() {
        tx.commit().await?;
        return Ok(outcome);
    }

    for (loser, keep) in connections(&rows) {
        sqlx::query(r#"UPDATE "Artist" SET "primaryArtistId" = $1, "updatedAt" = NOW() WHERE id = $2 AND "primaryArtistId" IS NULL"#)
            .bind(&keep)
            .bind(&loser)
            .execute(&mut *tx)
            .await?;
        // Anything connected to the loser follows it to the survivor - never a chain.
        sqlx::query(r#"UPDATE "Artist" SET "primaryArtistId" = $1, "updatedAt" = NOW() WHERE "primaryArtistId" = $2"#)
            .bind(&keep)
            .bind(&loser)
            .execute(&mut *tx)
            .await?;
        outcome.connected.push((loser, keep));
    }
    if !outcome.connected.is_empty() {
        rows = load_group(&mut tx, base).await?;
    }
    if rehome_releases(&mut tx, base, &rows, &mut outcome).await? || !outcome.moved.is_empty() {
        rows = load_group(&mut tx, base).await?;
    }

    let group_ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let like = format!("{}-%", base);
    let outside: HashSet<String> = sqlx::query_scalar::<_, String>(
        r#"SELECT slug FROM "Artist" WHERE (slug = $1 OR slug LIKE $2) AND NOT (id = ANY($3::text[]))"#,
    )
    .bind(base)
    .bind(&like)
    .bind(&group_ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    let desired = desired_slugs(base, &rows, &outside);
    let changes: Vec<(&GroupRow, String)> = rows
        .iter()
        .filter_map(|r| {
            desired
                .get(&r.id)
                .filter(|s| **s != r.slug)
                .map(|s| (r, s.clone()))
        })
        .collect();

    if !changes.is_empty() {
        // Two passes so a swap between members never trips the unique index halfway.
        for (row, _) in &changes {
            sqlx::query(r#"UPDATE "Artist" SET slug = $1 WHERE id = $2"#)
                .bind(format!("__homonym-{}", row.id))
                .bind(&row.id)
                .execute(&mut *tx)
                .await?;
        }
        for (row, new_slug) in &changes {
            sqlx::query(r#"UPDATE "Artist" SET slug = $1, "updatedAt" = NOW() WHERE id = $2"#)
                .bind(new_slug)
                .bind(&row.id)
                .execute(&mut *tx)
                .await?;
            // A provisional slug from a row created moments ago in this same run is not worth a redirect.
            let recent: bool = sqlx::query_scalar(
                r#"SELECT "createdAt" > NOW() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" WHERE "artistId" = $1)
                   FROM "Artist" WHERE id = $1"#,
            )
            .bind(&row.id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or(false);
            if !recent {
                sqlx::query(
                    r#"INSERT INTO "ArtistSlugHistory" ("oldSlug", "artistId", "createdAt") VALUES ($1, $2, NOW())
                       ON CONFLICT ("oldSlug") DO UPDATE SET "artistId" = EXCLUDED."artistId", "createdAt" = NOW()"#,
                )
                .bind(&row.slug)
                .bind(&row.id)
                .execute(&mut *tx)
                .await?;
            }
            outcome
                .renamed
                .push((row.id.clone(), row.slug.clone(), new_slug.clone()));
        }
    }

    // A live slug always wins over a redirect, and the bare slug of a group of two or more is the chooser's.
    let live: Vec<String> = desired.values().cloned().collect();
    sqlx::query(r#"DELETE FROM "ArtistSlugHistory" WHERE "oldSlug" = ANY($1::text[])"#)
        .bind(&live)
        .execute(&mut *tx)
        .await?;

    let primary_count = rows.iter().filter(|r| r.primary.is_none()).count();
    if primary_count > 1 {
        sqlx::query(r#"DELETE FROM "ArtistSlugHistory" WHERE "oldSlug" = $1"#)
            .bind(base)
            .execute(&mut *tx)
            .await?;
        // More than one artist answers to this name here, so the name alone can no longer stand for one id.
        let names: Vec<String> = rows.iter().map(|r| normalize_name(&r.name)).collect();
        sqlx::query(r#"UPDATE "MbArtistLookup" SET ambiguous = true, mbid = NULL WHERE normalized = ANY($1::text[]) AND NOT ambiguous"#)
            .bind(&names)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(outcome)
}

/// Reconcile every base slug in `bases`, skipping those already in shape with one cheap query up front - a full
/// library index touches tens of thousands of bases, almost all of them a single artist on its bare slug.
pub async fn reconcile_bases(
    pool: &PgPool,
    bases: &[String],
) -> Result<ReconcileOutcome, sqlx::Error> {
    let mut total = ReconcileOutcome::default();
    if bases.is_empty() {
        return Ok(total);
    }
    let needing: Vec<String> = sqlx::query_scalar(
        r#"SELECT "baseSlug" FROM "Artist" WHERE "baseSlug" = ANY($1::text[])
           GROUP BY "baseSlug"
           HAVING count(*) FILTER (WHERE "primaryArtistId" IS NULL) <> 1
               OR bool_or("primaryArtistId" IS NULL AND slug <> "baseSlug")
               OR bool_or("primaryArtistId" IS NOT NULL AND slug = "baseSlug")
           ORDER BY 1"#,
    )
    .bind(bases)
    .fetch_all(pool)
    .await?;
    for base in needing {
        total.absorb(reconcile_group(pool, &base).await?);
    }
    Ok(total)
}

/// Reconcile what an [`IdentityState`] touched, then drop its cache (rows may have been connected).
pub async fn reconcile_touched(
    pool: &PgPool,
    state: &mut IdentityState,
) -> Result<ReconcileOutcome, sqlx::Error> {
    let bases = state.touched();
    let outcome = reconcile_bases(pool, &bases).await?;
    state.touched.clear();
    state.clear_cache();
    Ok(outcome)
}

/// The base slugs of these artists and of every row connected to them - read *before* deleting or connecting them,
/// so their groups can be reconciled afterwards (a deleted member shrinks its group; its connected rows become
/// members again).
pub async fn bases_of(pool: &PgPool, artist_ids: &[String]) -> Result<Vec<String>, sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar(
        r#"SELECT DISTINCT "baseSlug" FROM "Artist"
           WHERE (id = ANY($1::text[]) OR "primaryArtistId" = ANY($1::text[])) AND "baseSlug" IS NOT NULL
           ORDER BY 1"#,
    )
    .bind(artist_ids)
    .fetch_all(pool)
    .await
}

/// Every base slug in the whole library that breaks the invariant - `./tidy`'s safety net and the tests' oracle.
/// Returns (base slug, what is wrong).
pub async fn violations(pool: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"WITH g AS (
             SELECT "baseSlug" AS base,
                    count(*) FILTER (WHERE "primaryArtistId" IS NULL) AS members,
                    count(*) FILTER (WHERE "primaryArtistId" IS NULL AND NULLIF("musicbrainzId", '') IS NULL) AS unidentified,
                    count(DISTINCT NULLIF("musicbrainzId", '')) FILTER (WHERE "primaryArtistId" IS NULL) AS ids,
                    count(NULLIF("musicbrainzId", '')) FILTER (WHERE "primaryArtistId" IS NULL) AS with_id,
                    bool_or("primaryArtistId" IS NULL AND slug = "baseSlug") AS bare_held_by_member,
                    bool_or(slug = "baseSlug") AS bare_held
             FROM "Artist" GROUP BY "baseSlug"
           )
           SELECT base, reason FROM (
             SELECT base, 'group of ' || members || ' but a member holds the bare slug' AS reason FROM g WHERE members > 1 AND bare_held
             UNION ALL SELECT base, members || ' unidentified members' FROM g WHERE unidentified > 1
             UNION ALL SELECT base, 'two members share an MB id' FROM g WHERE with_id > ids
             UNION ALL SELECT g.base, 'single member off its bare slug' FROM g
               WHERE members = 1 AND NOT bare_held_by_member
                 AND NOT EXISTS (SELECT 1 FROM "Artist" o WHERE o.slug = g.base AND o."baseSlug" <> g.base)
           ) v ORDER BY base, reason"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        id: &str,
        slug: &str,
        mbid: Option<&str>,
        primary: Option<&str>,
        owned: i64,
    ) -> GroupRow {
        GroupRow {
            id: id.into(),
            name: "Napa".into(),
            slug: slug.into(),
            mbid: mbid.map(Into::into),
            primary: primary.map(Into::into),
            owned,
        }
    }

    #[test]
    fn a_homonym_slug_uses_the_first_eight_of_the_mb_id() {
        let s = homonym_slug(
            "napa",
            Some("d76eeba7-d35c-4fe8-bffa-ce2885c97765"),
            "cxyz",
            &HashSet::new(),
        );
        assert_eq!(s, "napa-d76eeba7");
    }

    #[test]
    fn an_unidentified_member_uses_its_artist_id() {
        let s = homonym_slug("napa", None, "mjv481qlssilj6aztekqbe9c", &HashSet::new());
        assert_eq!(s, "napa-mjv481ql");
    }

    #[test]
    fn the_suffix_grows_when_the_short_form_is_taken() {
        let taken: HashSet<String> = ["napa-d76eeba7".to_string()].into();
        let s = homonym_slug(
            "napa",
            Some("d76eeba7-d35c-4fe8-bffa-ce2885c97765"),
            "c",
            &taken,
        );
        assert_eq!(s, "napa-d76eeba7d35c");
    }

    #[test]
    fn a_blank_mb_id_counts_as_none() {
        assert_eq!(
            homonym_slug("napa", Some("  "), "abcdefghij", &HashSet::new()),
            "napa-abcdefgh"
        );
    }

    #[test]
    fn titles_compare_without_case_accents_or_punctuation() {
        assert_eq!(normalize_title("Logo Se Vê"), normalize_title("logo se ve"));
        assert_eq!(normalize_title("11:11"), "1111");
        assert_ne!(
            normalize_title("Senso Comum"),
            normalize_title("Senso Comum II")
        );
    }

    #[test]
    fn a_single_member_takes_the_bare_slug() {
        let rows = vec![row("a", "napa-d76eeba7", Some("d76eeba7-x"), None, 2)];
        let d = desired_slugs("napa", &rows, &HashSet::new());
        assert_eq!(d["a"], "napa");
    }

    #[test]
    fn a_single_member_keeps_its_slug_when_an_unrelated_row_holds_the_bare_one() {
        let rows = vec![row("a", "napa-d76eeba7", Some("d76eeba7-x"), None, 2)];
        let outside: HashSet<String> = ["napa".to_string()].into();
        assert_eq!(desired_slugs("napa", &rows, &outside)["a"], "napa-d76eeba7");
    }

    #[test]
    fn every_member_of_a_group_is_suffixed_and_the_bare_slug_is_free() {
        let rows = vec![
            row("a", "napa", Some("d76eeba7-d35c"), None, 2),
            row("b", "napa-9f", Some("9f3423ee-debe"), None, 2),
            row("c", "napa-c", None, None, 1),
        ];
        let d = desired_slugs("napa", &rows, &HashSet::new());
        assert_eq!(d["a"], "napa-d76eeba7");
        assert_eq!(d["b"], "napa-9f3423ee");
        assert_eq!(d["c"], "napa-c");
        assert!(!d.values().any(|s| s == "napa"));
    }

    #[test]
    fn a_connected_row_gives_up_the_bare_slug_and_any_slug_a_member_needs() {
        let rows = vec![
            row("a", "napa-a", Some("d76eeba7-d35c"), None, 2),
            row("b", "napa-b", Some("9f3423ee-debe"), None, 1),
            row("z", "napa", Some("d76eeba7-d35c"), Some("a"), 0),
        ];
        let d = desired_slugs("napa", &rows, &HashSet::new());
        assert_ne!(d["z"], "napa");
        assert_ne!(d["z"], d["a"]);
        assert_ne!(d["z"], d["b"]);
    }

    #[test]
    fn same_mb_id_members_connect_to_the_one_owning_more() {
        let rows = vec![
            row("a", "napa", Some("x"), None, 1),
            row("b", "napa-b", Some("x"), None, 5),
            row("c", "napa-c", Some("y"), None, 1),
        ];
        assert_eq!(connections(&rows), vec![("a".to_string(), "b".to_string())]);
    }

    #[test]
    fn a_second_unidentified_member_connects_to_the_first() {
        let rows = vec![
            row("a", "napa-a", None, None, 3),
            row("b", "napa-b", None, None, 1),
            row("c", "napa-c", Some("y"), None, 1),
        ];
        assert_eq!(connections(&rows), vec![("b".to_string(), "a".to_string())]);
    }

    fn owned(owner: &str, file_ids: &[&str], catalogue: &[&str]) -> OwnedRelease {
        OwnedRelease {
            link_id: "l".into(),
            release_id: "r".into(),
            owner: owner.into(),
            file_ids: file_ids.iter().map(|s| s.to_string()).collect(),
            catalogue_members: catalogue.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn members() -> Vec<(String, Option<String>)> {
        vec![
            ("pt".into(), Some("PT".into())),
            ("kr".into(), Some("KR".into())),
        ]
    }

    #[test]
    fn a_release_goes_to_the_member_its_files_name() {
        assert_eq!(home_of(&owned("pt", &["PT"], &[]), &members()), Home::Keep);
        assert_eq!(
            home_of(&owned("pt", &["KR"], &[]), &members()),
            Home::Move("kr".into())
        );
        assert_eq!(
            home_of(&owned("pt", &["KR"], &["pt"]), &members()),
            Home::Move("kr".into()),
            "files beat catalogue"
        );
    }

    #[test]
    fn without_ids_the_one_member_whose_catalogue_holds_it_wins() {
        assert_eq!(
            home_of(&owned("kr", &[], &["pt"]), &members()),
            Home::Move("pt".into())
        );
        assert_eq!(home_of(&owned("pt", &[], &["pt"]), &members()), Home::Keep);
    }

    #[test]
    fn without_ids_or_unique_evidence_it_goes_to_the_unidentified_member() {
        assert_eq!(
            home_of(&owned("pt", &[], &[]), &members()),
            Home::ToUnidentified
        );
        assert_eq!(
            home_of(&owned("pt", &[], &["pt", "kr"]), &members()),
            Home::ToUnidentified
        );
        assert_eq!(
            home_of(&owned("pt", &["SOMEONE-ELSE"], &[]), &members()),
            Home::ToUnidentified
        );
        let mut with_unknown = members();
        with_unknown.push(("u".into(), None));
        assert_eq!(home_of(&owned("u", &[], &[]), &with_unknown), Home::Keep);
    }

    #[test]
    fn a_group_already_in_shape_needs_nothing() {
        let rows = vec![
            row("a", "napa-d76eeba7", Some("d76eeba7-d35c"), None, 2),
            row("b", "napa-9f3423ee", Some("9f3423ee-debe"), None, 2),
        ];
        assert!(connections(&rows).is_empty());
        let d = desired_slugs("napa", &rows, &HashSet::new());
        assert!(rows.iter().all(|r| d[&r.id] == r.slug));
    }
}
