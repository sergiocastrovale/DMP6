#!/usr/bin/env python3
"""
Check all artist folders containing ' & ' to detect compound artists
that should have been split into separate artists.

Signals checked per folder (from a sample of MP3 files):
  1. Multiple MusicBrainz Artist IDs (space-separated UUIDs in tag)
  2. artist-sort containing ";" (multiple sort names)
  3. TXXX:ARTISTS containing names that don't match the folder name
  4. TPE2/album_artist differs from folder name

Results logged to separator_analysis.log (one entry per folder).
"""

import os
import sys
import re
from pathlib import Path
from collections import Counter

try:
    from mutagen.id3 import ID3, ID3NoHeaderError
except ImportError:
    print("mutagen required: pip3 install --user --break-system-packages mutagen")
    sys.exit(1)

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def get_env(key):
    env_path = Path(__file__).resolve().parent.parent / "web" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


def sample_mp3s(folder, max_files=5):
    """Return up to max_files MP3 paths from the folder tree."""
    mp3s = []
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith(".mp3"):
                mp3s.append(os.path.join(root, f))
                if len(mp3s) >= max_files:
                    return mp3s
    return mp3s


def analyse_folder(folder_path, folder_name):
    mp3s = sample_mp3s(folder_path)
    if not mp3s:
        return None

    signals = []
    mb_artist_ids = set()
    mb_album_artist_ids = set()
    sort_names = set()
    tpe1_values = set()
    tpe2_values = set()
    txxx_artists_values = set()
    txxx_album_artists_values = set()

    for path in mp3s:
        try:
            tags = ID3(path)
        except (ID3NoHeaderError, Exception):
            continue

        tpe1 = str(tags.get("TPE1", "")).strip()
        tpe2 = str(tags.get("TPE2", "")).strip()
        sort_tag = str(tags.get("TSOP", "")).strip()  # artist sort
        sort_tag2 = str(tags.get("TSO2", "")).strip()  # album artist sort

        txxx_a = str(tags.get("TXXX:ARTISTS", "")).strip()
        txxx_aa = str(tags.get("TXXX:ALBUM_ARTISTS", "")).strip()
        mb_aid = str(tags.get("TXXX:MusicBrainz Artist Id", "")).strip()
        mb_aaid = str(tags.get("TXXX:MusicBrainz Album Artist Id", "")).strip()

        if tpe1:
            tpe1_values.add(tpe1)
        if tpe2:
            tpe2_values.add(tpe2)
        if txxx_a:
            txxx_artists_values.add(txxx_a)
        if txxx_aa:
            txxx_album_artists_values.add(txxx_aa)
        if sort_tag:
            sort_names.add(sort_tag)
        if sort_tag2:
            sort_names.add(sort_tag2)
        if mb_aid:
            mb_artist_ids.update(UUID_RE.findall(mb_aid))
        if mb_aaid:
            mb_album_artist_ids.update(UUID_RE.findall(mb_aaid))

    # --- Evaluate signals ---

    verdict = "SINGLE"  # default: assume it's one artist
    reasons = []

    # Signal 1: Multiple MB Album Artist IDs
    if len(mb_album_artist_ids) > 1:
        reasons.append(f"multiple MB album artist IDs ({len(mb_album_artist_ids)})")
        verdict = "MULTIPLE"

    # Signal 2: Multiple MB Artist IDs
    if len(mb_artist_ids) > 1:
        reasons.append(f"multiple MB artist IDs ({len(mb_artist_ids)})")
        if verdict != "MULTIPLE":
            verdict = "LIKELY_MULTIPLE"

    # Signal 3: Sort name contains ";" (multiple people)
    for sn in sort_names:
        if ";" in sn:
            reasons.append(f"sort name has ';': {sn}")
            verdict = "MULTIPLE"
            break

    # Signal 4: TXXX:ALBUM_ARTISTS differs from folder name
    for aa in txxx_album_artists_values:
        if aa.lower() != folder_name.lower() and "&" not in aa:
            reasons.append(f"ALBUM_ARTISTS='{aa}' (no '&', differs from folder)")
            if verdict == "SINGLE":
                verdict = "LIKELY_MULTIPLE"

    # Signal 5: TPE2 differs from folder name
    for v in tpe2_values:
        if v.lower() != folder_name.lower() and v.lower() != folder_name.lower():
            reasons.append(f"TPE2='{v}' differs from folder '{folder_name}'")

    if not reasons:
        reasons.append("all tags consistent with single artist")

    return {
        "verdict": verdict,
        "reasons": reasons,
        "tpe1": tpe1_values,
        "tpe2": tpe2_values,
        "txxx_artists": txxx_artists_values,
        "txxx_album_artists": txxx_album_artists_values,
        "mb_artist_ids": mb_artist_ids,
        "mb_album_artist_ids": mb_album_artist_ids,
        "sort_names": sort_names,
        "sample_count": len(mp3s),
    }


def main():
    music_dir = get_env("MUSIC_DIR")
    if not music_dir:
        print("MUSIC_DIR not found in web/.env")
        sys.exit(1)

    log_path = Path(__file__).resolve().parent.parent / "separator_analysis.log"

    folders = []
    for entry in sorted(os.listdir(music_dir)):
        if " & " in entry:
            full = os.path.join(music_dir, entry)
            if os.path.isdir(full) or os.path.islink(full):
                folders.append((entry, full))

    print(f"Found {len(folders)} artist folders with ' & '")
    print(f"Logging to {log_path}\n")

    multiple = []
    likely = []
    single = []

    with open(log_path, "w") as log:
        log.write("# Ampersand Artist Analysis\n")
        log.write(f"# Scanned {len(folders)} folders with ' & ' in name\n\n")

        for i, (name, path) in enumerate(folders, 1):
            sys.stdout.write(f"\r  [{i}/{len(folders)}] {name[:60]}...")
            sys.stdout.flush()

            result = analyse_folder(path, name)
            if result is None:
                log.write(f"## {name}\n")
                log.write(f"  Verdict: SKIPPED (no MP3 files found)\n\n")
                continue

            v = result["verdict"]
            if v == "MULTIPLE":
                multiple.append(name)
            elif v == "LIKELY_MULTIPLE":
                likely.append(name)
            else:
                single.append(name)

            log.write(f"## {name}\n")
            log.write(f"  Verdict: {v}\n")
            for r in result["reasons"]:
                log.write(f"    - {r}\n")
            if result["tpe2"]:
                log.write(f"  TPE2 values: {result['tpe2']}\n")
            if result["txxx_album_artists"]:
                log.write(f"  ALBUM_ARTISTS: {result['txxx_album_artists']}\n")
            if result["sort_names"]:
                log.write(f"  Sort names: {result['sort_names']}\n")
            if result["mb_album_artist_ids"]:
                log.write(f"  MB Album Artist IDs: {result['mb_album_artist_ids']}\n")
            log.write("\n")

        # Summary
        log.write("\n# Summary\n\n")
        log.write(f"MULTIPLE ({len(multiple)}):\n")
        for name in multiple:
            log.write(f"  - {name}\n")
        log.write(f"\nLIKELY_MULTIPLE ({len(likely)}):\n")
        for name in likely:
            log.write(f"  - {name}\n")
        log.write(f"\nSINGLE ({len(single)}):\n")
        for name in single:
            log.write(f"  - {name}\n")

    print(f"\r{'':80}")
    print(f"Results:")
    print(f"  MULTIPLE:        {len(multiple)}")
    print(f"  LIKELY_MULTIPLE: {len(likely)}")
    print(f"  SINGLE:          {len(single)}")
    print(f"\nDetails in {log_path}")


if __name__ == "__main__":
    main()
