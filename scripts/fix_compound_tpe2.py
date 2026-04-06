#!/usr/bin/env python3
"""
Fix compound artist TPE2 tags across the entire library.

Queries the DB for artists without a MusicBrainz ID whose names contain
'/', ' & ', or ', ' — these are unsplit compound artists created from
ambiguous TPE2 values. Replaces the separator in TPE2 with '\\' so the
sync script's split_artists() will split them correctly.

Usage:
    python3 scripts/fix_compound_tpe2.py              # Dry run
    python3 scripts/fix_compound_tpe2.py --apply      # Apply fixes
    python3 scripts/fix_compound_tpe2.py --apply --resync  # Apply + print resync command
"""

import argparse
import os
import re
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not installed. Run: pip3 install --user --break-system-packages psycopg2-binary")

try:
    from mutagen.id3 import ID3, ID3NoHeaderError, TPE2
except ImportError:
    sys.exit("mutagen not installed. Run: pip3 install --user --break-system-packages mutagen")


def get_database_url():
    env_path = os.path.join(os.path.dirname(__file__), "..", "web", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DATABASE_URL")


def get_music_dir():
    env_path = os.path.join(os.path.dirname(__file__), "..", "web", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("MUSIC_DIR="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("MUSIC_DIR")


def find_mp3s(folder, max_files=None):
    mp3s = []
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith((".mp3", ".m4a", ".flac", ".opus", ".ogg", ".aac")):
                mp3s.append(os.path.join(root, f))
                if max_files and len(mp3s) >= max_files:
                    return mp3s
    return mp3s


def split_compound_name(name):
    """Split a compound artist name into individual parts using \\ separator.
    Returns the \\-joined result, or None if it can't/shouldn't be split."""

    # Skip known single artists with separators in their names
    skip_names = {"AC/DC", "D/A A/D", "+/-"}
    if name in skip_names:
        return None

    # Special: broken field name leaked into tag value
    if name.startswith("lbumArtist/"):
        return name[len("lbumArtist/"):]

    # Split by all separators, cascading through each part
    parts = [name]

    # 1. Split by ' & '
    new_parts = []
    for p in parts:
        new_parts.extend(s.strip() for s in p.split(" & "))
    parts = new_parts

    # 2. Split by ', ' (only if parts look like full names, not "Last, First")
    new_parts = []
    for p in parts:
        sub = [s.strip() for s in p.split(", ")]
        if len(sub) >= 2 and any(" " in s for s in sub):
            new_parts.extend(sub)
        else:
            new_parts.append(p)
    parts = new_parts

    # 3. Split by '/'
    new_parts = []
    for p in parts:
        sub = [s.strip() for s in p.split("/")]
        if len(sub) >= 2 and all(len(s) > 1 for s in sub):
            new_parts.extend(sub)
        else:
            new_parts.append(p)
    parts = new_parts

    # 4. Split by ' w/ '
    new_parts = []
    for p in parts:
        new_parts.extend(s.strip() for s in p.split(" w/ "))
    parts = new_parts

    parts = [p for p in parts if p]

    if len(parts) <= 1:
        return None

    return "\\".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Fix compound TPE2 tags library-wide")
    parser.add_argument("--apply", action="store_true", help="Apply fixes (default: dry run)")
    parser.add_argument("--resync", action="store_true", help="Print resync command after applying")
    args = parser.parse_args()

    db_url = get_database_url()
    music_dir = get_music_dir()
    if not db_url:
        sys.exit("DATABASE_URL not found")
    if not music_dir:
        sys.exit("MUSIC_DIR not found")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Get all compound artists (no MB ID) with their release folder paths
    cur.execute("""
        SELECT DISTINCT a.name, lr."folderPath"
        FROM "Artist" a
        JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
        JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
        WHERE a."musicbrainzId" IS NULL
          AND (a.name LIKE '%%/%%' OR a.name LIKE '%% & %%' OR a.name LIKE '%%, %%' OR a.name LIKE '%% w/ %%')
        ORDER BY a.name, lr."folderPath"
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        print("No compound artists found.")
        return

    # Group by artist name
    artists = {}
    for name, folder_path in rows:
        if name not in artists:
            artists[name] = []
        artists[name].append(folder_path)

    print(f"Found {len(artists)} compound artists across {len(rows)} release folders\n")

    dry_run = not args.apply
    if dry_run:
        print("=== DRY RUN (use --apply to fix) ===\n")

    total_files_fixed = 0
    total_skipped = 0
    affected_parent_folders = set()

    for artist_name, folder_paths in sorted(artists.items()):
        new_tpe2 = split_compound_name(artist_name)
        if not new_tpe2:
            continue

        for rel_path in folder_paths:
            abs_path = os.path.join(music_dir, rel_path)
            if not os.path.isdir(abs_path):
                continue

            mp3s = find_mp3s(abs_path)
            if not mp3s:
                continue

            folder_fixed = 0
            for filepath in mp3s:
                if not filepath.lower().endswith(".mp3"):
                    continue  # mutagen ID3 only works with MP3

                try:
                    tags = ID3(filepath)
                except (ID3NoHeaderError, Exception):
                    continue

                tpe2 = str(tags.get("TPE2", "")).strip()
                if tpe2 == artist_name or tpe2.lower() == artist_name.lower():
                    if dry_run:
                        if folder_fixed == 0:
                            print(f"  {rel_path}")
                            print(f"    TPE2: {tpe2!r} -> {new_tpe2!r}")
                    else:
                        tags.delall("TPE2")
                        tags.add(TPE2(encoding=3, text=[new_tpe2]))
                        tags.save()
                    folder_fixed += 1

            if folder_fixed > 0:
                total_files_fixed += folder_fixed
                # Track parent artist folder for resync
                parts = rel_path.split("/")
                if parts:
                    affected_parent_folders.add(parts[0])
                if dry_run and folder_fixed > 1:
                    print(f"    ({folder_fixed} files)")
            else:
                total_skipped += 1

    print(f"\n{'Would fix' if dry_run else 'Fixed'}: {total_files_fixed} files")
    print(f"Affected artist folders: {len(affected_parent_folders)}")
    print(f"Skipped (no matching TPE2): {total_skipped}")

    if args.resync and affected_parent_folders:
        resync_list = ";".join(sorted(affected_parent_folders))
        print(f"\nResync command:")
        print(f'./sync --only="{resync_list}" --overwrite')

    if dry_run:
        print("\nRun with --apply to fix.")


if __name__ == "__main__":
    main()
