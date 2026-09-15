#!/usr/bin/env python3
"""One-off repair: strip artist photos that were never meant for that artist.

`index`'s folder-image fallback (`scripts/index/src/main.rs`) used to copy an artist root folder's
own cover art to every co-owner/credited artist under it that had no photo yet. On a various-artists
folder (a tribute compilation, a box set, a label sampler) that meant dozens of unrelated musicians
ended up displaying whichever one artist's photo the folder's `folder.jpg`/`cover.jpg` happened to be
(e.g. every uncredited "Rise Above: 24 Black Flag Songs..." guest vocalist inherited Chuck D's own
portrait; "Albert King;Otis Rush" and two other junk compounds display Albert King's photo). A separate
mechanism (`./artist-photos`, Wikidata/Wikipedia lookups) produces the same shape of duplicate for
aliases/members of the same real person (e.g. "Yusuf Islam" got a copy of "Cat Stevens"'s photo).

Both are now byte-identical copies sitting in `img/artists/`. This script finds every such duplicate
group, decides the one artist under the shared root folder(s) who actually is that folder's main
artist (the most track links - owner or credit - wins; a tie or no shared root leaves the group alone),
and removes the erroneous copies: `Artist.image` is NULLed for every non-owner in the group, and an
image file is deleted only once nothing still references it. Touches nothing else - no music files, no
other columns, no artist not part of a byte-identical duplicate group.

This is a throwaway script: run it once, then delete `oneoff/dedupe_artist_images.py` from both the
repo and the NAS.

Usage:
    python3 oneoff/dedupe_artist_images.py                 # dry run, prints the plan
    python3 oneoff/dedupe_artist_images.py --apply          # NULL the DB rows + delete the files

Requires: psycopg2, Pillow (both already on the NAS host).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

import psycopg2


def parse_database_url(env_path: str) -> str:
    """Read DATABASE_URL out of a .env file. Falls back to localhost if the configured host is not
    reachable - the NAS's own compose network name resolves only inside the container."""
    url = None
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not url:
        raise SystemExit(f"DATABASE_URL not found in {env_path}")
    return url


def connect(database_url: str):
    try:
        return psycopg2.connect(database_url)
    except psycopg2.OperationalError:
        fallback = re.sub(r"@[^:/]+:", "@localhost:", database_url)
        if fallback == database_url:
            raise
        return psycopg2.connect(fallback)


def hash_duplicate_groups(image_dir: Path) -> dict[str, list[str]]:
    """md5 -> filenames, for every byte-identical group of >=2 files. Dimensions aren't filtered -
    both the 200x200 folder-image copies and the 500px Wikidata-photo copies are real duplicates."""
    by_hash: dict[str, list[str]] = defaultdict(list)
    for entry in os.scandir(image_dir):
        if not entry.is_file():
            continue
        with open(entry.path, "rb") as f:
            digest = hashlib.md5(f.read()).hexdigest()
        by_hash[digest].append(entry.name)
    return {h: files for h, files in by_hash.items() if len(files) > 1}


def load_artist_image_map(conn) -> tuple[dict[str, list[str]], dict[str, str], dict[str, Optional[str]]]:
    """filename -> artist ids, id -> name, id -> primaryArtistId, for every artist with an image."""
    by_filename: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}
    primary: dict[str, Optional[str]] = {}
    with conn.cursor() as cur:
        cur.execute('SELECT id, name, image, "primaryArtistId" FROM "Artist" WHERE image IS NOT NULL')
        for artist_id, name, image, primary_id in cur.fetchall():
            by_filename[image].append(artist_id)
            names[artist_id] = name
            primary[artist_id] = primary_id
    return by_filename, names, primary


def load_root_track_counts(conn) -> tuple[dict[str, Counter], dict[str, set[str]]]:
    """Per root folder, per artist: how many tracks under that root they own the release of or are
    credited on. Mirrors index's `folder_artist_track_counts` (scripts/index/src/db.rs), but for every
    root in one query rather than one root at a time."""
    counts: dict[str, Counter] = defaultdict(Counter)
    roots_by_artist: dict[str, set[str]] = defaultdict(set)
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH tr AS (
                SELECT t.id AS tid, split_part(lr."folderPath", '/', 1) AS root, t."localReleaseId" AS rid
                FROM "LocalReleaseTrack" t
                JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
            )
            SELECT root, a, count(*) FROM (
                SELECT tr.root, tr.tid, lra."artistId" AS a FROM tr
                    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = tr.rid
                UNION
                SELECT tr.root, tr.tid, tra."artistId" AS a FROM tr
                    JOIN "TrackRelatedArtist" tra ON tra."trackId" = tr.tid
            ) x
            GROUP BY root, a
            """
        )
        for root, artist_id, count in cur.fetchall():
            counts[root][artist_id] = count
            roots_by_artist[artist_id].add(root)
    return counts, roots_by_artist


def pick_winner(root_counts: Counter) -> Optional[str]:
    """Strict-majority artist id for a root, or None on a tie/empty count - mirrors
    `pick_folder_image_owner` in scripts/index/src/db.rs. A various-artists folder with no single main
    artist keeps nobody's photo."""
    top = root_counts.most_common(2)
    if not top:
        return None
    if len(top) > 1 and top[0][1] == top[1][1]:
        return None
    return top[0][0]


def is_kept(candidate_id: str, winner_id: str, primary: dict[str, Optional[str]]) -> bool:
    """The winner itself, or a merge-twin of the winner (primaryArtistId either direction)."""
    return (
        candidate_id == winner_id
        or primary.get(candidate_id) == winner_id
        or primary.get(winner_id) == candidate_id
    )


def plan_group(
    files: list[str],
    by_filename: dict[str, list[str]],
    counts: dict[str, Counter],
    roots_by_artist: dict[str, set[str]],
    primary: dict[str, Optional[str]],
) -> tuple[str, list[str], Optional[str]]:
    """Returns (verdict, ids_to_clear, winner_id). verdict is one of: 'ok' (a clear winner decided
    the group), 'no-owner' (tie, or the shared root's winner isn't even in this group - nobody keeps
    it), 'skip-no-shared-root', 'skip-ambiguous', 'skip-too-few-db-rows'."""
    members = [aid for f in files for aid in by_filename.get(f, [])]
    if len(members) < 2:
        return "skip-too-few-db-rows", [], None

    member_set = set(members)
    shared_roots = set.intersection(*(roots_by_artist.get(m, set()) for m in members))
    if not shared_roots:
        return "skip-no-shared-root", [], None

    winners_by_root = {root: pick_winner(counts[root]) for root in shared_roots}
    in_group = {w for w in winners_by_root.values() if w is not None and w in member_set}

    if len(in_group) > 1:
        return "skip-ambiguous", [], None
    if len(in_group) == 1:
        winner = next(iter(in_group))
        to_clear = [m for m in members if not is_kept(m, winner, primary)]
        return "ok", to_clear, winner

    # No shared root's winner is even a member of this group: either a genuine tie (no main artist)
    # or the real owner already has their own distinct photo. Either way nobody in the group is the
    # legitimate owner of these bytes.
    return "no-owner", members, None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", default="/mnt/SSD/web/dmp/.env", help="path to the .env holding DATABASE_URL")
    ap.add_argument("--image-dir", default="/mnt/SSD/web/dmp/img/artists", help="artist image directory")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()

    image_dir = Path(args.image_dir)
    database_url = parse_database_url(args.env)
    conn = connect(database_url)

    print("Hashing artist images...")
    dup_groups = hash_duplicate_groups(image_dir)
    print(f"{len(dup_groups)} byte-identical group(s) among {sum(len(v) for v in dup_groups.values())} file(s).")

    print("Loading DB state...")
    by_filename, names, primary = load_artist_image_map(conn)
    counts, roots_by_artist = load_root_track_counts(conn)

    ids_to_clear: set[str] = set()
    filenames_touched: set[str] = set()
    verdicts: Counter = Counter()

    print("Planning...")
    for files in dup_groups.values():
        verdict, to_clear, winner = plan_group(files, by_filename, counts, roots_by_artist, primary)
        verdicts[verdict] += 1
        if verdict not in ("ok", "no-owner") or not to_clear:
            if verdict not in ("ok", "no-owner"):
                print(f"  SKIP ({verdict}): {files}")
            continue
        print(
            f"  {'keep=' + names[winner] if winner else 'no owner'}: "
            f"removing {[names[i] for i in to_clear]}"
        )
        ids_to_clear.update(to_clear)
        for aid in to_clear:
            for f in files:
                if aid in by_filename.get(f, []):
                    filenames_touched.add(f)

    print()
    print(f"Verdicts: {dict(verdicts)}")
    print(f"Artist rows to clear: {len(ids_to_clear)}")

    if not ids_to_clear:
        print("Nothing to do.")
        conn.close()
        return

    if not args.apply:
        print("Dry run - nothing written. Re-run with --apply to write changes.")
        conn.close()
        return

    print("Clearing Artist.image for the erroneous rows...")
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "Artist" SET image = NULL, "updatedAt" = NOW() WHERE id = ANY(%s)',
                (list(ids_to_clear),),
            )
    print(f"  {len(ids_to_clear)} row(s) cleared.")

    print("Removing image files no longer referenced by any artist...")
    # Re-check: a filename stays if any artist (in the DB, not just this group) still has
    # image = filename after the clear above - never delete a file a legitimate owner still needs.
    with conn.cursor() as cur:
        cur.execute('SELECT DISTINCT image FROM "Artist" WHERE image IS NOT NULL')
        still_referenced = {row[0] for row in cur.fetchall()}

    removed = 0
    for filename in sorted(filenames_touched):
        if filename in still_referenced:
            continue
        path = image_dir / filename
        try:
            path.unlink()
            removed += 1
        except FileNotFoundError:
            pass
    print(f"  {removed} file(s) removed.")

    conn.close()


if __name__ == "__main__":
    main()
