#!/usr/bin/env python3
"""
Check all artist folders containing ' & ', '&', ' / ', or '/' to detect compound
artists that should have been split into separate artists.

Signals checked per folder (from a sample of MP3 files):
  1. Multiple MusicBrainz Artist IDs (space-separated UUIDs in tag)
  2. artist-sort containing ";" (multiple sort names)
  3. TXXX:ARTISTS containing names that don't match the folder name
  4. TPE2/album_artist differs from folder name

Optional (--mb-lookup):
  5. Query MusicBrainz to confirm each split part is a real artist

Results logged to separator_analysis.log (one entry per folder).

Usage:
  python3 check_ampersand_artists.py              # tag-based analysis only
  python3 check_ampersand_artists.py --mb-lookup  # also query MusicBrainz API
"""

import os
import sys
import re
import time
import json
import urllib.request
import urllib.parse
import argparse
from pathlib import Path
from collections import Counter

try:
    from mutagen.id3 import ID3, ID3NoHeaderError
except ImportError:
    print("mutagen required: pip3 install --user --break-system-packages mutagen")
    sys.exit(1)

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

# Separators to scan for, ordered from most to least specific.
# Each is (pattern_in_name, display_label, default_verdict)
# '/' almost always means multiple artists; '&' is ambiguous.
SEPARATORS = [
    (" / ", "slash-spaced",    "LIKELY_MULTIPLE"),
    (" & ", "ampersand-spaced","SINGLE"),
    ("/",   "slash-bare",      "LIKELY_MULTIPLE"),
    ("&",   "ampersand-bare",  "SINGLE"),
]

_MB_LAST_CALL = 0.0
MB_RATE_LIMIT_S = 1.1  # MusicBrainz asks for max 1 req/sec


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


def mb_lookup_artist(name):
    """Query MusicBrainz for an artist by name. Returns (found: bool, mbid: str|None)."""
    global _MB_LAST_CALL
    elapsed = time.time() - _MB_LAST_CALL
    if elapsed < MB_RATE_LIMIT_S:
        time.sleep(MB_RATE_LIMIT_S - elapsed)
    _MB_LAST_CALL = time.time()

    query = urllib.parse.quote(f'artist:"{name}"')
    url = f"https://musicbrainz.org/ws/2/artist/?query={query}&fmt=json&limit=5"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "DMP-check-artists/1.0 (personal-library-tool)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        for a in data.get("artists", []):
            if a.get("name", "").lower() == name.lower():
                return True, a.get("id")
        return False, None
    except Exception as e:
        return None, str(e)  # None = lookup error


def split_by_separator(folder_name, separator):
    """Split folder name by the detected separator into candidate artist names."""
    parts = [p.strip() for p in folder_name.split(separator)]
    return [p for p in parts if p]


def analyse_folder(folder_path, folder_name, separator, default_verdict, do_mb_lookup):
    mp3s = sample_mp3s(folder_path)
    if not mp3s:
        return None

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
        sort_tag = str(tags.get("TSOP", "")).strip()
        sort_tag2 = str(tags.get("TSO2", "")).strip()
        txxx_a = str(tags.get("TXXX:ARTISTS", "")).strip()
        txxx_aa = str(tags.get("TXXX:ALBUM_ARTISTS", "")).strip()
        mb_aid = str(tags.get("TXXX:MusicBrainz Artist Id", "")).strip()
        mb_aaid = str(tags.get("TXXX:MusicBrainz Album Artist Id", "")).strip()

        if tpe1: tpe1_values.add(tpe1)
        if tpe2: tpe2_values.add(tpe2)
        if txxx_a: txxx_artists_values.add(txxx_a)
        if txxx_aa: txxx_album_artists_values.add(txxx_aa)
        if sort_tag: sort_names.add(sort_tag)
        if sort_tag2: sort_names.add(sort_tag2)
        if mb_aid: mb_artist_ids.update(UUID_RE.findall(mb_aid))
        if mb_aaid: mb_album_artist_ids.update(UUID_RE.findall(mb_aaid))

    verdict = default_verdict
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

    # Signal 4: TXXX:ALBUM_ARTISTS differs from folder name and has no separator
    for aa in txxx_album_artists_values:
        sep_in_aa = any(s in aa for s, _, _ in SEPARATORS)
        if aa.lower() != folder_name.lower() and not sep_in_aa:
            reasons.append(f"ALBUM_ARTISTS='{aa}' (differs from folder, no separator)")
            if verdict == "SINGLE":
                verdict = "LIKELY_MULTIPLE"

    # Signal 5 (optional): MusicBrainz API lookup for each split part
    mb_lookup_results = {}
    if do_mb_lookup and verdict != "MULTIPLE":
        parts = split_by_separator(folder_name, separator)
        if len(parts) >= 2:
            all_found = True
            for part in parts:
                found, mbid = mb_lookup_artist(part)
                if found is None:
                    mb_lookup_results[part] = f"error: {mbid}"
                    all_found = False
                elif found:
                    mb_lookup_results[part] = mbid
                else:
                    mb_lookup_results[part] = None
                    all_found = False
            if all_found:
                reasons.append(f"MB confirms each split part is a distinct artist")
                verdict = "MULTIPLE"
            else:
                found_parts = [p for p, v in mb_lookup_results.items() if v and not v.startswith("error")]
                if found_parts:
                    reasons.append(f"MB found {len(found_parts)}/{len(parts)} split parts as artists")
                    if verdict == "SINGLE":
                        verdict = "LIKELY_MULTIPLE"

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
        "mb_lookup": mb_lookup_results,
        "sample_count": len(mp3s),
    }


def main():
    parser = argparse.ArgumentParser(description="Check compound artist folders")
    parser.add_argument("--mb-lookup", action="store_true",
                        help="Query MusicBrainz API to confirm each split part is a real artist")
    args = parser.parse_args()

    music_dir = get_env("MUSIC_DIR")
    if not music_dir:
        print("MUSIC_DIR not found in web/.env")
        sys.exit(1)

    log_path = Path(__file__).resolve().parent.parent / "separator_analysis.log"

    # Collect folders, recording which separator matched first
    seen = set()
    folders = []  # (folder_name, full_path, separator, label, default_verdict)
    for entry in sorted(os.listdir(music_dir)):
        if entry in seen:
            continue
        full = os.path.join(music_dir, entry)
        if not (os.path.isdir(full) or os.path.islink(full)):
            continue
        for sep, label, default_verdict in SEPARATORS:
            if sep in entry:
                folders.append((entry, full, sep, label, default_verdict))
                seen.add(entry)
                break

    sep_counts = Counter(label for _, _, _, label, _ in folders)
    total = len(folders)
    print(f"Found {total} artist folders with separators:")
    for sep, label, _ in SEPARATORS:
        c = sep_counts.get(label, 0)
        if c:
            print(f"  {repr(sep):8s} ({label}): {c}")
    print(f"Logging to {log_path}\n")
    if args.mb_lookup:
        print("MB lookup enabled — this will be slow (~1 req/sec per split part)\n")

    multiple = []
    likely = []
    single = []
    skipped = []

    with open(log_path, "w") as log:
        log.write("# Separator Artist Analysis\n")
        log.write(f"# Scanned {total} folders with separators (' & ', '&', ' / ', '/')\n")
        log.write(f"# MB lookup: {'enabled' if args.mb_lookup else 'disabled'}\n\n")

        for i, (name, path, sep, label, default_verdict) in enumerate(folders, 1):
            sys.stdout.write(f"\r  [{i}/{total}] {name[:60]}{'...' if len(name)>60 else ''}  ")
            sys.stdout.flush()

            result = analyse_folder(path, name, sep, default_verdict, args.mb_lookup)
            if result is None:
                skipped.append(name)
                log.write(f"## {name}  [{label}]\n")
                log.write(f"  Verdict: SKIPPED (no MP3 files found)\n\n")
                continue

            v = result["verdict"]
            if v == "MULTIPLE":
                multiple.append((name, label))
            elif v == "LIKELY_MULTIPLE":
                likely.append((name, label))
            else:
                single.append((name, label))

            log.write(f"## {name}  [{label}]\n")
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
            if result["mb_lookup"]:
                for part, mbid in result["mb_lookup"].items():
                    status = f"found ({mbid})" if mbid and not str(mbid).startswith("error") else (mbid or "not found")
                    log.write(f"  MB lookup '{part}': {status}\n")
            log.write("\n")

        # Summary
        log.write("\n# Summary\n\n")
        log.write(f"MULTIPLE ({len(multiple)}):\n")
        for name, label in multiple:
            log.write(f"  - {name}  [{label}]\n")
        log.write(f"\nLIKELY_MULTIPLE ({len(likely)}):\n")
        for name, label in likely:
            log.write(f"  - {name}  [{label}]\n")
        log.write(f"\nSINGLE ({len(single)}):\n")
        for name, label in single:
            log.write(f"  - {name}  [{label}]\n")
        if skipped:
            log.write(f"\nSKIPPED ({len(skipped)}):\n")
            for name in skipped:
                log.write(f"  - {name}\n")

    print(f"\r{'':80}")
    print(f"Results:")
    print(f"  MULTIPLE:        {len(multiple)}")
    print(f"  LIKELY_MULTIPLE: {len(likely)}")
    print(f"  SINGLE:          {len(single)}")
    if skipped:
        print(f"  SKIPPED:         {len(skipped)}")
    print(f"\nDetails in {log_path}")


if __name__ == "__main__":
    main()
