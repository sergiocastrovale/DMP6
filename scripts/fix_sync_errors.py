#!/usr/bin/env python3
"""
Parse errors.log and fix erroneous MP3 files by category:
  1. Invalid encoding → strip + rewrite as ID3v2.4 UTF-8 (mutagen)
  2. Invalid item size → ffmpeg lossless remux
  3. Invalid MPEG frame → ffmpeg lossless remux
  4. APE UTF-8 error → strip APE tags, keep ID3v2
  5. Missing artist tag → read TXXX:ARTISTS/TXXX:ALBUM_ARTISTS → TPE1/TPE2

Usage:
    python3 scripts/fix_sync_errors.py                    # dry run
    python3 scripts/fix_sync_errors.py --apply            # apply fixes
    python3 scripts/fix_sync_errors.py --apply --only=encoding  # only fix encoding errors

Requires: mutagen, ffmpeg (on PATH)
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict

try:
    from mutagen.mp3 import MP3
    from mutagen.id3 import ID3, ID3NoHeaderError, TPE1, TPE2
except ImportError:
    sys.exit("mutagen not installed. Run: pip3 install --user --break-system-packages mutagen")


ERRORS_LOG = os.path.join(os.path.dirname(__file__), "..", "errors.log")

# When running inside Docker, the music path may differ from the logged path
MUSIC_PATH_REMAP = os.environ.get("MUSIC_PATH_REMAP")  # e.g. "/mnt/dmp/music/mainstream=/music"

# Patterns to extract file paths and error types
RE_FAILED_READ = re.compile(
    r'\[SYNC\] Failed to read: (.+\.mp3) \(cannot read tags: (.+?)\)'
)
RE_MISSING_ARTIST = re.compile(
    r'\[SYNC\] Missing artist tag: (.+)$'
)


def remap_path(path):
    """Apply path remapping if MUSIC_PATH_REMAP is set."""
    if MUSIC_PATH_REMAP and "=" in MUSIC_PATH_REMAP:
        src, dst = MUSIC_PATH_REMAP.split("=", 1)
        if path.startswith(src):
            return dst + path[len(src):]
    return path


def parse_errors(log_path):
    """Parse errors.log into categorized file lists."""
    categories = {
        "encoding": [],      # invalid encoding
        "item_size": [],     # invalid item size
        "mpeg_frame": [],    # invalid MPEG frame
        "ape_utf8": [],      # APE UTF-8 conversion error
        "missing_artist": [],  # missing artist tag
    }

    with open(log_path) as f:
        for line in f:
            m = RE_FAILED_READ.search(line)
            if m:
                path, reason = remap_path(m.group(1)), m.group(2)
                if "invalid encoding" in reason:
                    categories["encoding"].append(path)
                elif "invalid item size" in reason:
                    categories["item_size"].append(path)
                elif "invalid frame" in reason:
                    categories["mpeg_frame"].append(path)
                elif "UTF-8" in reason:
                    categories["ape_utf8"].append(path)
                continue

            m = RE_MISSING_ARTIST.search(line)
            if m:
                categories["missing_artist"].append(remap_path(m.group(1)))

    return categories


def fix_encoding(path, dry_run=True):
    """Strip and rewrite tags as ID3v2.4 UTF-8."""
    if not os.path.exists(path):
        return "not_found"

    if dry_run:
        return "would_fix"

    try:
        # Read existing tags with fallback encoding
        audio = MP3(path)
        if audio.tags is None:
            return "no_tags"

        # Collect all tag data
        saved_tags = {}
        for key, val in audio.tags.items():
            saved_tags[key] = val

        # Delete all tags
        audio.delete()

        # Rewrite as ID3v2.4
        audio = MP3(path)
        audio.add_tags()
        for key, val in saved_tags.items():
            try:
                # Force UTF-8 encoding (encoding=3)
                if hasattr(val, 'encoding'):
                    val.encoding = 3
                audio.tags[key] = val
            except Exception:
                pass  # skip tags that can't be converted

        audio.save(v2_version=4)
        return "fixed"
    except Exception as e:
        return f"error: {e}"


def fix_remux(path, dry_run=True):
    """Lossless remux with ffmpeg to fix corrupt frames/item sizes."""
    if not os.path.exists(path):
        return "not_found"

    if dry_run:
        return "would_fix"

    tmp = path + ".tmp.mp3"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", path, "-c", "copy", "-map_metadata", "0", tmp],
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            if os.path.exists(tmp):
                os.remove(tmp)
            return f"ffmpeg_error: {result.stderr[-200:]}"

        # Replace original
        shutil.move(tmp, path)
        return "fixed"
    except Exception as e:
        if os.path.exists(tmp):
            os.remove(tmp)
        return f"error: {e}"


def fix_ape_strip(path, dry_run=True):
    """Strip APE tags, keep ID3v2."""
    if not os.path.exists(path):
        return "not_found"

    if dry_run:
        return "would_fix"

    try:
        from mutagen.apev2 import APEv2
        ape = APEv2(path)
        ape.delete()
        return "fixed"
    except Exception as e:
        return f"error: {e}"


def fix_missing_artist(path, dry_run=True):
    """Read artist from TXXX tags or folder name, write to TPE1/TPE2."""
    if not os.path.exists(path):
        return "not_found"

    if dry_run:
        return "would_fix"

    try:
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
            tags.save(path)
            tags = ID3(path)

        # Check if TPE1 already exists
        if 'TPE1' in tags:
            return "already_has_artist"

        artist = None
        for txxx_key in ['TXXX:ARTISTS', 'TXXX:ALBUM_ARTISTS', 'TXXX:ALBUMARTIST']:
            if txxx_key in tags:
                artist = str(tags[txxx_key])
                break

        # Fall back to TPE2 (album artist)
        if not artist and 'TPE2' in tags:
            artist = str(tags['TPE2'])

        # Fall back to folder name
        if not artist:
            # Path like: Artist/Albums/Year - Album/file.mp3
            # Extract first component relative to music root
            parts = path.replace("/mnt/dmp/music/mainstream/", "").split("/")
            if parts:
                artist = parts[0]

        if artist:
            tags.add(TPE1(encoding=3, text=[artist]))
            if 'TPE2' not in tags:
                tags.add(TPE2(encoding=3, text=[artist]))
            tags.save(path)
            return f"fixed ({artist})"
        else:
            return "no_artist_source"
    except Exception as e:
        return f"error: {e}"


FIX_FUNCTIONS = {
    "encoding": fix_encoding,
    "item_size": fix_remux,
    "mpeg_frame": fix_remux,
    "ape_utf8": fix_ape_strip,
    "missing_artist": fix_missing_artist,
}

CATEGORY_LABELS = {
    "encoding": "Invalid encoding",
    "item_size": "Invalid item size",
    "mpeg_frame": "Invalid MPEG frame",
    "ape_utf8": "APE UTF-8 error",
    "missing_artist": "Missing artist tag",
}


def main():
    parser = argparse.ArgumentParser(description="Fix sync errors from errors.log")
    parser.add_argument("--apply", action="store_true", help="Actually apply fixes (default: dry run)")
    parser.add_argument("--only", help="Only fix one category: encoding, item_size, mpeg_frame, ape_utf8, missing_artist")
    parser.add_argument("--log", default=ERRORS_LOG, help="Path to errors.log")
    args = parser.parse_args()

    if not os.path.exists(args.log):
        sys.exit(f"errors.log not found at {args.log}")

    # Check ffmpeg availability
    if not shutil.which("ffmpeg"):
        print("WARNING: ffmpeg not found on PATH — remux fixes will fail")

    categories = parse_errors(args.log)

    if args.only:
        if args.only not in categories:
            sys.exit(f"Unknown category: {args.only}. Choose from: {', '.join(categories.keys())}")
        categories = {args.only: categories[args.only]}

    dry_run = not args.apply
    if dry_run:
        print("=== DRY RUN (use --apply to execute) ===\n")

    total_fixed = 0
    total_errors = 0

    for cat, files in categories.items():
        if not files:
            continue

        label = CATEGORY_LABELS[cat]
        fix_fn = FIX_FUNCTIONS[cat]

        # Group by artist for reporting
        by_artist = defaultdict(list)
        for f in files:
            artist = f.replace("/mnt/dmp/music/mainstream/", "").split("/")[0] if "/mnt/dmp/music/mainstream/" in f else "unknown"
            by_artist[artist].append(f)

        print(f"--- {label} ({len(files)} files, {len(by_artist)} artists) ---")
        for artist in sorted(by_artist):
            artist_files = by_artist[artist]
            results = defaultdict(int)
            for filepath in artist_files:
                result = fix_fn(filepath, dry_run=dry_run)
                results[result] += 1
                if result == "fixed" or result.startswith("fixed"):
                    total_fixed += 1
                elif "error" in result:
                    total_errors += 1

            status_parts = []
            for status, count in sorted(results.items()):
                status_parts.append(f"{status}: {count}")
            print(f"  {artist} ({len(artist_files)} files): {', '.join(status_parts)}")

        print()

    print(f"=== Summary: {total_fixed} fixed, {total_errors} errors ===")

    if dry_run and total_fixed == 0:
        # In dry run, count would_fix instead
        would_fix = sum(
            len(files) for files in categories.values()
        )
        print(f"Would fix {would_fix} files. Run with --apply to execute.")


if __name__ == "__main__":
    main()
