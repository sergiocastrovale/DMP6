#!/usr/bin/env python3
"""
Find tracks with missing title, artist, or album tags and derive values from
the folder structure (YEAR - AlbumTitle) and filename.

Usage:
    python3 scripts/fix_incomplete_metadata.py               # dry run
    python3 scripts/fix_incomplete_metadata.py --apply        # fix tags + print resync commands

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


def parse_album_from_folder(folder_name):
    m = re.match(r"^\d{4}\s*-\s*(.+)$", folder_name)
    return m.group(1).strip() if m else folder_name.strip()


def parse_year_from_folder(folder_name):
    m = re.match(r"^(\d{4})\s*-\s*", folder_name)
    return int(m.group(1)) if m else None


def parse_title_from_filename(filename, artist=None, album=None):
    name = os.path.splitext(filename)[0]
    # "Artist - Album - NN - Title"
    if artist and album:
        prefix = re.escape(artist) + r"\s*-\s*" + re.escape(album) + r"\s*-\s*\d+\s*-\s*"
        m = re.match(prefix, name, re.IGNORECASE)
        if m:
            return name[m.end():].strip()
    # "NN - Title" / "NN.Title" / "NN) Title"
    m = re.match(r"^(\d{1,3})\s*[-._)]\s*(.+)$", name)
    if m:
        return m.group(2).strip()
    # "NN Title"
    m = re.match(r"^(\d{1,3})\s+([A-Z].+)$", name)
    if m:
        return m.group(2).strip()
    return name.strip()


def find_issues(db_url):
    """Return dict of filepath -> {field: value} fixes."""
    rows = query_db(db_url, '''
        SELECT lrt."filePath", lrt.title, lrt.artist, lrt.album, lrt."albumArtist"
        FROM "LocalReleaseTrack" lrt
        WHERE lrt.title IS NULL OR lrt.artist IS NULL OR lrt.album IS NULL
        ORDER BY lrt."filePath"
    ''')

    fixes = {}
    for r in rows:
        while len(r) < 5:
            r.append("")
        filepath, title, artist, album, album_artist = r
        title = title or None
        artist = artist or None
        album = album or None
        album_artist = album_artist or None

        parts = filepath.split("/")
        if len(parts) < 3:
            continue

        filename = parts[-1]
        folder_name = parts[-2]
        fix = {}

        if not album:
            derived = parse_album_from_folder(folder_name)
            if derived:
                fix["album"] = derived

        if not title:
            derived = parse_title_from_filename(
                filename, artist or album_artist, album or fix.get("album"))
            if derived:
                fix["title"] = derived

        year = parse_year_from_folder(folder_name)
        if year:
            fix["year"] = year

        if fix:
            fixes[filepath] = fix

    return fixes


def run_nas_fixer(data, env):
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
    parser = argparse.ArgumentParser(description="Fix incomplete metadata tags")
    parser.add_argument("--apply", action="store_true", help="Apply tag fixes (default: dry run)")
    args = parser.parse_args()

    env = load_env()
    fixes = find_issues(env["DATABASE_URL"])

    if not fixes:
        print("No incomplete metadata found.")
        return

    title_fixes = sum(1 for f in fixes.values() if "title" in f)
    album_fixes = sum(1 for f in fixes.values() if "album" in f)
    artists = sorted({fp.split("/")[0] for fp in fixes})

    print(f"Files to fix: {len(fixes)}")
    print(f"  Title fixes: {title_fixes}")
    print(f"  Album fixes: {album_fixes}")
    print(f"  Artists affected: {len(artists)}")

    # Show samples
    print("\nSamples:")
    for fp, fix in list(fixes.items())[:5]:
        print(f"  {fp}")
        for k, v in fix.items():
            print(f"    {k}: {v}")

    if args.apply:
        resync = artists
        data = {"fixes": fixes, "resync": resync}
        print()
        run_nas_fixer(data, env)
        print(f"\nResync commands:")
        for i in range(0, len(resync), 10):
            batch = resync[i:i + 10]
            print(f'  ./sync --only="{";".join(batch)}" --overwrite')
    else:
        print("\nDry run. Use --apply to fix tags.")


if __name__ == "__main__":
    main()
