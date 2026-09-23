#!/usr/bin/env python3
"""Canonical, id-free snapshots of the library tables, and a diff between two snapshots.

Every row is keyed by natural keys (groupKey, filePath, slug, MusicBrainz ids) instead of generated
ids, and volatile columns (createdAt/updatedAt/last*At, hashes of run state) are left out, so two
runs of the same code on the same baseline produce identical files.

Usage:
  snapshot.py take <database_url> <out_dir>
  snapshot.py diff <dir_a> <dir_b> [--show N]
"""

import os
import subprocess
import sys

QUERIES = {
    "artist": """
        SELECT a.slug, a.name, a."musicbrainzId", a.completeness, a."totalTracks", a."totalFileSize",
               a.country, a.monitored, a."manuallyAdded", p.slug
        FROM "Artist" a LEFT JOIN "Artist" p ON p.id = a."primaryArtistId" """,
    "mb_release": """
        SELECT r."musicbrainzId", r.title, t.slug, r.year, r."releaseGroupId", r.disambiguation,
               r."editionLabel", r."releaseDate", r.packaging, r.country, r.format, r.status,
               r."statusReason", r."mediumCount", r."releaseGroupSecondaryTypes"
        FROM "MusicBrainzRelease" r JOIN "ReleaseType" t ON t.id = r."typeId" """,
    "mb_track": """
        SELECT r."musicbrainzId", mt."discNumber", mt.position, mt."musicbrainzId", mt."recordingId",
               mt.title, mt."durationMs"
        FROM "MusicBrainzReleaseTrack" mt JOIN "MusicBrainzRelease" r ON r.id = mt."releaseId" """,
    "mb_medium": """
        SELECT r."musicbrainzId", m.position, m.title, m.format, m."trackCount", m."recordingFingerprint",
               m."equivalentReleaseGroupId", e."musicbrainzId", m."equivalentMediumPosition"
        FROM "MusicBrainzReleaseMedium" m
        JOIN "MusicBrainzRelease" r ON r.id = m."releaseId"
        LEFT JOIN "MusicBrainzRelease" e ON e.id = m."equivalentReleaseId" """,
    "mb_release_artist": """
        SELECT r."musicbrainzId", a.slug
        FROM "MusicBrainzReleaseArtist" x
        JOIN "MusicBrainzRelease" r ON r.id = x."releaseId" JOIN "Artist" a ON a.id = x."artistId" """,
    "local_release": """
        SELECT lr."groupKey", lr.title, lr.year, r."musicbrainzId", lr."matchStatus", lr."statusReason",
               lr."forcedComplete", lr."folderPath", lr.image, lr."imageUrl", lr."totalDuration",
               lr."totalFileSize", lr."downloadedFrom", lr."mediumPosition", b."musicbrainzId",
               lr."boxMediumPosition"
        FROM "LocalRelease" lr
        LEFT JOIN "MusicBrainzRelease" r ON r.id = lr."releaseId"
        LEFT JOIN "MusicBrainzRelease" b ON b.id = lr."boxReleaseId" """,
    "local_track": """
        SELECT t."filePath", lr."groupKey", mr."musicbrainzId", mt."discNumber", mt.position,
               mt."musicbrainzId", t.title, t.artist, t."albumArtist", t.album, t.year,
               t."trackNumber", t."discNumber", t."mbReleaseId", t."mbReleaseGroupId"
        FROM "LocalReleaseTrack" t
        LEFT JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
        LEFT JOIN "MusicBrainzReleaseTrack" mt ON mt.id = t."mbTrackId"
        LEFT JOIN "MusicBrainzRelease" mr ON mr.id = mt."releaseId" """,
    "local_release_artist": """
        SELECT lr."groupKey", a.slug
        FROM "LocalReleaseArtist" x
        JOIN "LocalRelease" lr ON lr.id = x."localReleaseId" JOIN "Artist" a ON a.id = x."artistId" """,
    "track_related_artist": """
        SELECT t."filePath", a.slug
        FROM "TrackRelatedArtist" x
        JOIN "LocalReleaseTrack" t ON t.id = x."trackId" JOIN "Artist" a ON a.id = x."artistId" """,
    "local_release_member": """
        SELECT m."folderPath", lr."groupKey", m."discNumber"
        FROM "LocalReleaseMember" m JOIN "LocalRelease" lr ON lr.id = m."localReleaseId" """,
    "statistics": """
        SELECT artists, "mainArtists", "creditArtists", playtime, tracks, releases, genres,
               "artistsSyncedWithMusicbrainz", "releasesSyncedWithMusicbrainz", "artistsWithCoverArt",
               "releasesWithCoverArt", "totalFileSize"
        FROM "Statistics" """,
}


def take(database_url, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, query in QUERIES.items():
        path = os.path.join(out_dir, name + ".tsv")
        with open(path, "wb") as f:
            subprocess.run(
                ["psql", database_url, "-X", "-q", "-c", f"COPY ({query}) TO STDOUT"],
                stdout=f,
                check=True,
            )
        subprocess.run(["sort", "-o", path, path], env={**os.environ, "LC_ALL": "C"}, check=True)


def diff(dir_a, dir_b, show):
    changed = 0
    for name in QUERIES:
        a_path, b_path = (os.path.join(d, name + ".tsv") for d in (dir_a, dir_b))
        with open(a_path, "rb") as f:
            a = set(f.read().splitlines())
        with open(b_path, "rb") as f:
            b = set(f.read().splitlines())
        only_a, only_b = sorted(a - b), sorted(b - a)
        status = "same" if not only_a and not only_b else f"-{len(only_a)} +{len(only_b)}"
        print(f"{name:22s} {len(a):>9d} rows  {status}")
        if only_a or only_b:
            changed += 1
            for line in only_a[:show]:
                print("   - " + line.decode(errors="replace"))
            for line in only_b[:show]:
                print("   + " + line.decode(errors="replace"))
    return changed


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == "take":
        take(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 4 and sys.argv[1] == "diff":
        show = int(sys.argv[5]) if len(sys.argv) >= 6 and sys.argv[4] == "--show" else 5
        sys.exit(1 if diff(sys.argv[2], sys.argv[3], show) else 0)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
