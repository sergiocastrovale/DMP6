use sqlx::PgConnection;

/// Delete the releases this run just orphaned - and only those.
///
/// Both sweeps are scoped to the ids the deletion plan actually touched. Unscoped (as this was
/// previously written for local releases) the query swept EVERY ownerless `LocalRelease` in the
/// library, so deleting one artist could garbage-collect unrelated releases that merely happened to
/// be between owners - notably mid-index, before the artist-resolution pass assigns ownership.
pub async fn sweep_orphaned_releases(
    tx: &mut PgConnection,
    local_release_ids: &[String],
    mb_release_ids: &[String],
) -> Result<(), sqlx::Error> {
    if !local_release_ids.is_empty() {
        sqlx::query(
            r#"DELETE FROM "LocalRelease"
               WHERE id = ANY($1::text[])
                 AND id NOT IN (SELECT DISTINCT "localReleaseId" FROM "LocalReleaseArtist")"#,
        )
        .bind(local_release_ids)
        .execute(&mut *tx)
        .await?;
    }

    if !mb_release_ids.is_empty() {
        sqlx::query(
            r#"DELETE FROM "MusicBrainzRelease"
               WHERE id = ANY($1::text[])
                 AND id NOT IN (SELECT DISTINCT "releaseId" FROM "MusicBrainzReleaseArtist")"#,
        )
        .bind(mb_release_ids)
        .execute(&mut *tx)
        .await?;
    }

    Ok(())
}
