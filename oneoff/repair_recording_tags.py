#!/usr/bin/env python3
"""One-off repair: undo release-track ids written into the recording-id tag slot.

`common::tags::write_mb_ids` (scripts/common/src/tags.rs) used to write each track's MusicBrainz
*release-track* id into the recording slot - Picard's MUSICBRAINZ_TRACKID / ID3 UFID, which holds the
*recording*. A normal sync filled it wherever the tag was empty, and `--overwrite` replaced correct
Picard values with it. This script finds every owned file whose recording tag equals a known
release-track id (MBIDs are unique across entity types, so that is proof, never a coincidence) and
rewrites it to that track's recording id, or blanks it when the recording is not known yet. No other
tag value is touched, and mtimes are kept so a plain re-index never sees these files as changed. No
MusicBrainz calls - the DB already has every id this needs.

This is a throwaway script: run it once (see docs/__plan_tidy_script.md Step 7), then delete
`oneoff/` from both the repo and the NAS. It replaces what used to be `sync --repair-recording-tags`.

Usage:
    python3 oneoff/repair_recording_tags.py --only "FŒHN"                  # dry run, one artist
    python3 oneoff/repair_recording_tags.py --apply --only "FŒHN"          # apply, one artist
    python3 oneoff/repair_recording_tags.py --apply --workers 8            # full library, in tmux

Requires: mutagen, psycopg2 (both already on the NAS host per docs/__plan_tidy_script.md).
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from mutagen.flac import FLAC
from mutagen.id3 import ID3, TXXX, UFID
from mutagen.mp4 import MP4, MP4FreeForm
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis

MB_OWNER = "http://musicbrainz.org"
MP4_RECORDING_KEY = "----:com.apple.iTunes:MusicBrainz Track Id"
MP4_RELEASE_TRACK_KEY = "----:com.apple.iTunes:MusicBrainz Release Track Id"
VORBIS_RECORDING_KEY = "musicbrainz_trackid"
VORBIS_RELEASE_TRACK_KEY = "musicbrainz_releasetrackid"
TXXX_RELEASE_TRACK_DESC = "MusicBrainz Release Track Id"

LOOKUP_BATCH_SIZE = 1000
PROGRESS_EVERY = 500
CHECKPOINT_FILE = ".recording_tags_done"


@dataclass
class TrackIds:
    recording: Optional[str]
    release_track: Optional[str]


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
        # The compose network hostname (e.g. "ix-postgres-postgres-1") only resolves inside the
        # container - retry against the host's published port instead.
        fallback = re.sub(r"@[^:/]+:", "@localhost:", database_url)
        if fallback == database_url:
            raise
        return psycopg2.connect(fallback)


def fetch_candidates(conn, only: Optional[str]) -> list[str]:
    sql = (
        'SELECT DISTINCT lrt."filePath" FROM "LocalReleaseTrack" lrt '
        'JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId" '
        'JOIN "Artist" a ON a.id = lra."artistId" '
    )
    params: list = []
    if only:
        sql += "WHERE a.name ILIKE %s "
        params.append(f"%{only}%")
    sql += "ORDER BY 1"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [row[0] for row in cur.fetchall()]


def read_ids(path: Path) -> TrackIds:
    ext = path.suffix.lower().lstrip(".")
    if ext in ("mp3", "aac"):
        return _read_id3(path)
    if ext == "flac":
        return _read_vorbis(FLAC(path))
    if ext == "ogg":
        return _read_vorbis(OggVorbis(path))
    if ext == "opus":
        return _read_vorbis(OggOpus(path))
    if ext == "m4a":
        return _read_mp4(path)
    raise ValueError(f"unsupported extension: {ext}")


def _trim(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _read_id3(path: Path) -> TrackIds:
    tags = ID3(path)
    recording = None
    for frame in tags.getall("UFID"):
        if frame.owner == MB_OWNER:
            data = frame.data
            recording = data.decode("ascii", errors="ignore") if isinstance(data, bytes) else str(data)
            break
    release_track = None
    txxx = tags.get(f"TXXX:{TXXX_RELEASE_TRACK_DESC}")
    if txxx is not None:
        release_track = str(txxx.text[0]) if txxx.text else None
    return TrackIds(_trim(recording), _trim(release_track))


def _read_vorbis(f) -> TrackIds:
    recording = None
    release_track = None
    for key, values in f.tags.items() if f.tags else []:
        lk = key.lower()
        if lk == VORBIS_RECORDING_KEY and values:
            recording = values[0]
        elif lk == VORBIS_RELEASE_TRACK_KEY and values:
            release_track = values[0]
    return TrackIds(_trim(recording), _trim(release_track))


def _mp4_freeform_str(values) -> Optional[str]:
    if not values:
        return None
    v = values[0]
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", errors="ignore")
    return str(v)


def _read_mp4(path: Path) -> TrackIds:
    f = MP4(path)
    recording = _mp4_freeform_str(f.tags.get(MP4_RECORDING_KEY)) if f.tags else None
    release_track = _mp4_freeform_str(f.tags.get(MP4_RELEASE_TRACK_KEY)) if f.tags else None
    return TrackIds(_trim(recording), _trim(release_track))


def plan_fix(recording: Optional[str], known_recording: Optional[str], is_release_track: bool) -> str:
    """Mirrors common::tags::plan_recording_fix. Returns one of 'keep', 'replace', 'blank'."""
    if recording is None or not is_release_track:
        return "keep"
    if known_recording:
        return "replace"
    return "blank"


def apply_fix(path: Path, fix: str, new_recording: Optional[str], release_track_value: str) -> None:
    ext = path.suffix.lower().lstrip(".")
    st = os.stat(path)
    if ext in ("mp3", "aac"):
        _apply_id3(path, fix, new_recording, release_track_value)
    elif ext == "flac":
        _apply_vorbis(FLAC(path), path, fix, new_recording, release_track_value)
    elif ext == "ogg":
        _apply_vorbis(OggVorbis(path), path, fix, new_recording, release_track_value)
    elif ext == "opus":
        _apply_vorbis(OggOpus(path), path, fix, new_recording, release_track_value)
    elif ext == "m4a":
        _apply_mp4(path, fix, new_recording, release_track_value)
    else:
        raise ValueError(f"unsupported extension: {ext}")
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))


def _apply_id3(path: Path, fix: str, new_recording: Optional[str], release_track_value: str) -> None:
    tags = ID3(path)
    for frame_key in [k for k in tags.keys() if k.startswith("UFID:")]:
        frame = tags[frame_key]
        if frame.owner == MB_OWNER:
            del tags[frame_key]
    if fix == "replace":
        tags.add(UFID(owner=MB_OWNER, data=new_recording.encode("ascii")))
    # 'blank' removes the frame and leaves it removed (handled by the delete loop above).

    release_key = f"TXXX:{TXXX_RELEASE_TRACK_DESC}"
    if release_key not in tags:
        tags.add(TXXX(desc=TXXX_RELEASE_TRACK_DESC, text=[release_track_value]))

    # Keep whichever ID3 version the file already used (2.3 vs 2.4) - never force an upgrade/downgrade
    # of every other frame just to fix these two.
    version = tags.version[1] if tags.version and len(tags.version) > 1 else 4
    tags.save(path, v2_version=version)


def _apply_vorbis(f, path: Path, fix: str, new_recording: Optional[str], release_track_value: str) -> None:
    if f.tags is None:
        f.add_tags()
    tags = f.tags
    for key in [k for k in list(tags.keys()) if k.lower() == VORBIS_RECORDING_KEY]:
        del tags[key]
    if fix == "replace":
        tags[VORBIS_RECORDING_KEY.upper()] = [new_recording]
    if not any(k.lower() == VORBIS_RELEASE_TRACK_KEY for k in tags.keys()):
        tags[VORBIS_RELEASE_TRACK_KEY.upper()] = [release_track_value]
    f.save()


def _apply_mp4(path: Path, fix: str, new_recording: Optional[str], release_track_value: str) -> None:
    f = MP4(path)
    if f.tags is None:
        f.add_tags()
    tags = f.tags
    if MP4_RECORDING_KEY in tags:
        del tags[MP4_RECORDING_KEY]
    if fix == "replace":
        tags[MP4_RECORDING_KEY] = [MP4FreeForm(new_recording.encode("utf-8"))]
    if MP4_RELEASE_TRACK_KEY not in tags:
        tags[MP4_RELEASE_TRACK_KEY] = [MP4FreeForm(release_track_value.encode("utf-8"))]
    f.save()


def lookup_recordings(conn, values: list[str]) -> dict[str, Optional[str]]:
    """Which of `values` are MusicBrainz release-track ids, mapped to their recording id when known.
    Mirrors db::get_recordings_for_release_track_ids."""
    result: dict[str, Optional[str]] = {}
    with conn.cursor() as cur:
        for i in range(0, len(values), LOOKUP_BATCH_SIZE):
            batch = values[i : i + LOOKUP_BATCH_SIZE]
            cur.execute(
                'SELECT "musicbrainzId", max("recordingId") FROM "MusicBrainzReleaseTrack" '
                'WHERE "musicbrainzId" = ANY(%s) GROUP BY 1',
                (batch,),
            )
            for mb_id, recording_id in cur.fetchall():
                result[mb_id] = recording_id
    return result


def load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.rstrip("\n") for line in f if line.strip()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", default="/mnt/SSD/web/dmp/.env", help="path to the .env holding DATABASE_URL")
    ap.add_argument("--music-dir", default="/mnt/dmp/music/mainstream", help="root the DB's filePath is relative to")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--only", default=None, help="artist name substring, case-insensitive")
    ap.add_argument("--workers", type=int, default=8, help="thread pool size for file reads")
    ap.add_argument("--resume", action="store_true", help="skip files already recorded in the checkpoint file")
    args = ap.parse_args()

    database_url = parse_database_url(args.env)
    conn = connect(database_url)
    conn.autocommit = True

    print(f"Fetching candidate file list{f' for artists matching \"{args.only}\"' if args.only else ''}...")
    rel_paths = fetch_candidates(conn, args.only)
    print(f"{len(rel_paths)} candidate file(s).")

    checkpoint_path = Path(__file__).parent / CHECKPOINT_FILE
    done: set[str] = load_checkpoint(checkpoint_path) if args.resume else set()
    if done:
        rel_paths = [p for p in rel_paths if p not in done]
        print(f"{len(rel_paths)} remaining after --resume.")

    music_dir = Path(args.music_dir)
    abs_paths = [(rel, music_dir / rel) for rel in rel_paths]

    scanned = 0
    missing = 0
    failed = 0
    read_ids_by_path: dict[str, TrackIds] = {}

    print("Reading tags...")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for rel, abs_path in abs_paths:
            if not abs_path.exists():
                missing += 1
                scanned += 1
                continue
            futures[pool.submit(read_ids, abs_path)] = rel

        for fut in as_completed(futures):
            rel = futures[fut]
            scanned += 1
            try:
                read_ids_by_path[rel] = fut.result()
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the run
                failed += 1
                print(f"  FAILED reading {rel}: {e}", file=sys.stderr)
            if scanned % PROGRESS_EVERY == 0:
                print(f"  [{scanned}/{len(abs_paths)}] read")

    # Candidates whose recording tag is a genuine MB release-track id, ready to plan.
    candidate_values = sorted({ids.recording for ids in read_ids_by_path.values() if ids.recording})
    print(f"Looking up {len(candidate_values)} distinct recording-slot value(s) against MusicBrainzReleaseTrack...")
    lookup = lookup_recordings(conn, candidate_values)

    replaced = 0
    blanked = 0
    csv_rows: list[tuple[str, str, str, str]] = []

    artists_touched: set[str] = set()

    print("Applying..." if args.apply else "Planning (dry run)...")
    for rel, ids in read_ids_by_path.items():
        if ids.recording is None or ids.recording not in lookup:
            continue
        known_recording = lookup[ids.recording]
        fix = plan_fix(ids.recording, known_recording, is_release_track=True)
        if fix == "keep":
            continue

        old_value = ids.recording
        new_value = known_recording if fix == "replace" else ""
        csv_rows.append((rel, fix, old_value, new_value or ""))
        if fix == "replace":
            replaced += 1
        else:
            blanked += 1
        artists_touched.add(rel.split("/", 1)[0])

        if args.apply:
            abs_path = music_dir / rel
            try:
                apply_fix(abs_path, fix, known_recording, ids.release_track or old_value)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAILED writing {rel}: {e}", file=sys.stderr)
                continue

        if args.resume:
            with open(checkpoint_path, "a", encoding="utf-8") as f:
                f.write(rel + "\n")

    if csv_rows:
        ts = datetime.now().strftime("%Y%m%d-%H%M")
        csv_path = Path(__file__).parent / f"recording_tags_{ts}.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["path", "action", "old_recording_value", "new_recording_value"])
            writer.writerows(csv_rows)
        print(f"Change record written to {csv_path}")

    print()
    print(
        f"{scanned} file(s) read across {len(artists_touched)} artist folder(s) "
        f"({missing} missing on disk, {failed} failed): "
        f"{replaced} recording tag(s) {'rewritten' if args.apply else 'would be rewritten'} "
        f"to the recording id, {blanked} {'blanked' if args.apply else 'would be blanked'} "
        f"(recording unknown)"
    )
    if not args.apply:
        print("Dry run - nothing written. Re-run with --apply to write changes.")

    conn.close()


if __name__ == "__main__":
    main()
