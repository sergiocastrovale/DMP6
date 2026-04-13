#!/usr/bin/env python3
"""
Find duplicate artists (same normalized name, different DB records) and fix
album-artist tags on the smaller set so that a resync merges them.

Pairs where both artists have different MusicBrainz IDs are skipped (they are
confirmed different artists that happen to normalize the same way).

Usage:
    python3 scripts/fix_duplicates.py               # dry run — list pairs and file counts
    python3 scripts/fix_duplicates.py --apply        # fix tags + print resync commands

Requires: mutagen (on the machine where files live)
"""

import argparse
import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def load_env():
    for p in [os.path.join(PROJECT_ROOT, "web", ".env"),
              os.path.join(PROJECT_ROOT, ".env")]:
        if os.path.exists(p):
            env = {}
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip('"').strip("'")
            return env
    sys.exit("Cannot find web/.env")


def query_db(db_url, sql):
    r = subprocess.run(
        ["psql", db_url, "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, timeout=30,
    )
    if r.returncode != 0:
        print(f"DB error: {r.stderr.strip()}", file=sys.stderr)
        return []
    return [line.split("\t") for line in r.stdout.strip().split("\n") if line.strip()]


def find_pairs(db_url):
    """Return list of (rename_from, rename_to, file_paths)."""
    rows = query_db(db_url, '''
        SELECT a1.name, a1."totalTracks", a1."musicbrainzId",
               a2.name, a2."totalTracks", a2."musicbrainzId"
        FROM "Artist" a1
        JOIN "Artist" a2
          ON LOWER(REPLACE(a1.name, ' ', '')) = LOWER(REPLACE(a2.name, ' ', ''))
          AND a1.id < a2.id
        WHERE a1."totalTracks" > 0 OR a2."totalTracks" > 0
        ORDER BY a1.name
    ''')

    pairs = []
    for r in rows:
        n1, t1, mb1, n2, t2, mb2 = r[0], int(r[1]), r[2], r[3], int(r[4]), r[5]
        # Both have different MB IDs → confirmed different artists
        if mb1 and mb2 and mb1 != mb2:
            continue
        # Canonical = larger track count (minimises file changes)
        if t1 >= t2:
            rename_from, rename_to = n2, n1
        else:
            rename_from, rename_to = n1, n2

        escaped = rename_from.replace("'", "''")
        files = query_db(db_url, f'''
            SELECT lrt."filePath" FROM "LocalReleaseTrack" lrt
            JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
            JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
            JOIN "Artist" a ON lra."artistId" = a.id
            WHERE a.name = '{escaped}'
            ORDER BY lrt."filePath"
        ''')
        paths = [f[0] for f in files]
        if paths:
            pairs.append((rename_from, rename_to, paths))
    return pairs


def apply_fixes(pairs, env):
    mapping = {}
    resync = set()
    for rename_from, rename_to, paths in pairs:
        for p in paths:
            mapping[p] = rename_to
        resync.add(rename_to)

    data = {"mapping": mapping, "resync": sorted(resync)}
    return run_nas_fixer(data, env)


def run_nas_fixer(data, env):
    """Write mapping JSON, send to NAS, run fix_tags.py."""
    music_dir = env.get("MUSIC_DIR", "")
    local_accessible = os.path.isdir(music_dir)

    tmp = "/tmp/dmp_fix_mapping.json"
    with open(tmp, "w") as f:
        json.dump(data, f)

    if local_accessible:
        r = subprocess.run(
            [sys.executable, os.path.join(SCRIPT_DIR, "fix_tags.py"), tmp, "--apply"],
            env={**os.environ, "MUSIC_DIR": music_dir},
        )
        return r.returncode == 0

    host = env.get("SERVER_HOST")
    user = env.get("SERVER_USER")
    key = env.get("SSH_KEY_PATH")
    nas_music = "/mnt/dmp/music/mainstream"
    if not (host and user and key):
        print("MUSIC_DIR not accessible and SSH not configured. Mapping saved to:", tmp)
        return False

    ssh = ["ssh", "-i", key, f"{user}@{host}"]
    scp = ["scp", "-i", key]
    nas_script = "/tmp/fix_tags.py"
    nas_json = "/tmp/dmp_fix_mapping.json"

    subprocess.run([*scp, os.path.join(SCRIPT_DIR, "fix_tags.py"), tmp,
                    f"{user}@{host}:/tmp/"], capture_output=True)
    r = subprocess.run(
        [*ssh, f"MUSIC_DIR={nas_music} python3 {nas_script} {nas_json} --apply"],
        timeout=600,
    )
    return r.returncode == 0


def main():
    parser = argparse.ArgumentParser(description="Fix duplicate artists")
    parser.add_argument("--apply", action="store_true", help="Apply tag fixes (default: dry run)")
    args = parser.parse_args()

    env = load_env()
    pairs = find_pairs(env["DATABASE_URL"])

    if not pairs:
        print("No duplicate artists found.")
        return

    total_files = 0
    resync_artists = set()
    for rename_from, rename_to, paths in pairs:
        total_files += len(paths)
        resync_artists.add(rename_to)
        print(f"  {rename_from} -> {rename_to} ({len(paths)} files)")

    print(f"\nTotal: {len(pairs)} pairs, {total_files} files to retag")

    if args.apply:
        print()
        apply_fixes(pairs, env)
        print(f"\nResync commands:")
        artists = sorted(resync_artists)
        for i in range(0, len(artists), 10):
            batch = artists[i:i + 10]
            print(f'  ./sync --only="{";".join(batch)}" --overwrite')
    else:
        print("\nDry run. Use --apply to fix tags.")


if __name__ == "__main__":
    main()
