#!/usr/bin/env python3
"""Fix file tags on the NAS. Reads a JSON mapping file.

Usage:
    python3 fix_tags.py /path/to/mapping.json --dry-run
    python3 fix_tags.py /path/to/mapping.json --apply

JSON formats supported:

  Album artist rename: {"mapping": {"path.mp3": "New Album Artist", ...}, "resync": [...]}
  Metadata fix:        {"fixes": {"path.mp3": {"title": "...", "album": "...", "year": 1987}, ...}, "resync": [...]}
  Multi-artist split:  {"splits": {"path.mp3": ["Artist1", "Artist2"], ...}, "resync": [...]}
"""

import json
import os
import sys

import mutagen
from mutagen.id3 import ID3, TPE2, TIT2, TALB, TDRC, TRCK, TPE1
from mutagen.mp4 import MP4
from mutagen.oggvorbis import OggVorbis
from mutagen.flac import FLAC
from mutagen.oggopus import OggOpus

MUSIC_DIR = os.environ.get("MUSIC_DIR", "/mnt/dmp/music/mainstream")

TAG_MAP_ID3 = {
    "album_artist": ("TPE2", TPE2),
    "title": ("TIT2", TIT2),
    "album": ("TALB", TALB),
    "year": ("TDRC", TDRC),
    "track": ("TRCK", TRCK),
    "artist": ("TPE1", TPE1),
}

def set_tags(filepath, tags_dict):
    """Set multiple tags on a file. tags_dict: {field: value}. Returns (ok, err)."""
    try:
        f = mutagen.File(filepath)
        if f is None:
            return False, "unrecognized format"

        if isinstance(f, mutagen.mp3.MP3):
            if f.tags is None:
                f.add_tags()
            for field, value in tags_dict.items():
                if field not in TAG_MAP_ID3:
                    continue
                tag_name, tag_class = TAG_MAP_ID3[field]
                f.tags.delall(tag_name)
                f.tags.add(tag_class(encoding=3, text=[str(value)]))
            f.save()
            return True, None

        elif isinstance(f, MP4):
            mp4_map = {
                "album_artist": "aART", "title": "\xa9nam",
                "album": "\xa9alb", "year": "\xa9day",
                "track": "trkn", "artist": "\xa9ART",
            }
            for field, value in tags_dict.items():
                key = mp4_map.get(field)
                if not key:
                    continue
                if field == "track":
                    f[key] = [(int(value), 0)]
                else:
                    f[key] = [str(value)]
            f.save()
            return True, None

        elif isinstance(f, (FLAC, OggVorbis, OggOpus)):
            vorbis_map = {
                "album_artist": "ALBUMARTIST", "title": "TITLE",
                "album": "ALBUM", "year": "DATE",
                "track": "TRACKNUMBER", "artist": "ARTIST",
            }
            for field, value in tags_dict.items():
                key = vorbis_map.get(field)
                if key:
                    f[key] = [str(value)]
            f.save()
            return True, None

        else:
            return False, "unsupported: " + type(f).__name__
    except Exception as e:
        return False, str(e)


def run_mapping(data, dry_run):
    """Handle album artist rename format."""
    mapping = data["mapping"]
    resync = data.get("resync", [])

    print("=== Fix Album Artist Tags ===")
    print("Files to process:", len(mapping), "\n")

    fixed = missing = errors = 0
    for rel_path, new_name in sorted(mapping.items()):
        full_path = os.path.join(MUSIC_DIR, rel_path)
        if not os.path.exists(full_path):
            print("  MISSING:", rel_path)
            missing += 1
            continue
        if dry_run:
            fixed += 1
        else:
            ok, err = set_tags(full_path, {"album_artist": new_name})
            if ok:
                fixed += 1
            else:
                print("  ERROR (" + str(err) + "):", rel_path)
                errors += 1

    return fixed, missing, errors, resync


def run_fixes(data, dry_run):
    """Handle metadata fix format."""
    fixes = data["fixes"]
    resync = data.get("resync", [])

    print("=== Fix Metadata Tags ===")
    print("Files to process:", len(fixes), "\n")

    fixed = missing = errors = 0
    for rel_path, tags in sorted(fixes.items()):
        full_path = os.path.join(MUSIC_DIR, rel_path)
        if not os.path.exists(full_path):
            print("  MISSING:", rel_path)
            missing += 1
            continue
        if dry_run:
            fixed += 1
        else:
            ok, err = set_tags(full_path, tags)
            if ok:
                fixed += 1
            else:
                print("  ERROR (" + str(err) + "):", rel_path)
                errors += 1

    return fixed, missing, errors, resync


def run_splits(data, dry_run):
    """Handle multi-artist split format: set TPE2 to backslash-separated list."""
    splits = data["splits"]
    resync = data.get("resync", [])

    print("=== Fix Multi-Artist Tags ===")
    print("Files to process:", len(splits), "\n")

    fixed = missing = errors = 0
    for rel_path, artists in sorted(splits.items()):
        full_path = os.path.join(MUSIC_DIR, rel_path)
        if not os.path.exists(full_path):
            print("  MISSING:", rel_path)
            missing += 1
            continue
        # Double backslash is an unambiguous always-split separator in sync
        new_value = "\\\\".join(artists)
        if dry_run:
            fixed += 1
        else:
            ok, err = set_tags(full_path, {"album_artist": new_value})
            if ok:
                fixed += 1
            else:
                print("  ERROR (" + str(err) + "):", rel_path)
                errors += 1

    return fixed, missing, errors, resync


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in ("--dry-run", "--apply"):
        print("Usage: python3 fix_tags.py mapping.json --dry-run|--apply")
        sys.exit(1)

    dry_run = sys.argv[2] == "--dry-run"
    mode = "DRY RUN" if dry_run else "APPLY"
    print("Mode:", mode, "\n")

    with open(sys.argv[1]) as f:
        data = json.load(f)

    if "mapping" in data:
        fixed, missing, errors, resync = run_mapping(data, dry_run)
    elif "fixes" in data:
        fixed, missing, errors, resync = run_fixes(data, dry_run)
    elif "splits" in data:
        fixed, missing, errors, resync = run_splits(data, dry_run)
    else:
        print("ERROR: JSON must contain 'mapping', 'fixes', or 'splits' key")
        sys.exit(1)

    label = "Would fix" if dry_run else "Fixed"
    print("\n" + label + ":", fixed)
    if missing:
        print("Missing:", missing)
    if errors:
        print("Errors:", errors)

    if resync:
        print("\nResync (" + str(len(resync)) + " artists):")
        for i in range(0, len(resync), 10):
            batch = resync[i:i+10]
            print('  ./sync --only="' + ";".join(batch) + '" --overwrite')


if __name__ == "__main__":
    main()
