#!/usr/bin/env python3
"""
Find releases linked to a single artist whose albumArtist tag contains
separator characters (feat., /, ;) and rewrite them as backslash-delimited
multi-value tags so that sync creates proper multi-artist links.

Categories handled:
  feat  — "X feat. Y", "X ft. Y", "X feat Y"   → X\\Y
  slash — "X / Y" (space-slash-space)            → X\\Y
  semi  — "X; Y", "X;Y"                         → X\\Y

Skipped (needs manual review):
  comma — too ambiguous (band names vs. multi-artist)
  backslash — already uses the right delimiter, just needs resync

Usage:
    python3 scripts/fix_unsplit_multiartist.py                        # dry run — full report
    python3 scripts/fix_unsplit_multiartist.py --apply                # fix all categories
    python3 scripts/fix_unsplit_multiartist.py --apply --only=feat    # fix feat. only
    python3 scripts/fix_unsplit_multiartist.py --report               # show comma entries for manual review

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

# Band names that contain separator chars but are NOT multi-artist
BAND_NAMES = {
    "ac/dc", "gza/genius", "joy/disaster", "mats/morgan", "manna/mirage",
    "emerson, lake & palmer", "earth, wind & fire",
    "blood, sweat & tears", "crosby, stills & nash",
    "crosby, stills, nash & young", "hank williams, jr.",
    "hank williams, jr", "nothing,nowhere.", "the reds, pinks & purples",
    "an ancient legend, long forgotten", "right away, great captain!",
    "slaughter beach, dog", "loney, dear", "goodnight, texas",
    "weddings, parties, anything", "albert hammond, jr",
    "albert hammond, jr.", "black country, new road",
    "dream, ivory", "invent, animate", "mcguinn, clark & hillman",
    "carney, hild & kramer", "allo, darlin'",
    "maurizio bianchi / m.b.",
}


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
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        print(f"DB error: {r.stderr.strip()}", file=sys.stderr)
        return []
    return [line.split("\t") for line in r.stdout.strip().split("\n") if line.strip()]


def split_feat(tag):
    tag = re.sub(r"\s*\(feat\.?\s+", " feat. ", tag, flags=re.IGNORECASE)
    tag = tag.rstrip(")")
    parts = re.split(r"\s+(?:feat\.?|ft\.)\s+", tag, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()]


def split_slash(tag):
    return [p.strip() for p in tag.split(" / ") if p.strip()]


def split_semicolon(tag):
    parts = re.split(r"\s*;\s*", tag)
    return [p.strip() for p in parts if p.strip()]


def find_issues(db_url):
    """Return categorised dict: {category: {albumArtist: [filepaths]}}."""
    rows = query_db(db_url, r'''
        SELECT lrt."filePath", lrt."albumArtist", a.name
        FROM "LocalRelease" lr
        JOIN "LocalReleaseTrack" lrt ON lr.id = lrt."localReleaseId"
        JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
        JOIN "Artist" a ON lra."artistId" = a.id
        JOIN (
            SELECT "localReleaseId" FROM "LocalReleaseArtist"
            GROUP BY "localReleaseId" HAVING COUNT(*) = 1
        ) singles ON lr.id = singles."localReleaseId"
        WHERE lrt."albumArtist" IS NOT NULL
          AND (lrt."albumArtist" LIKE '%/%'
            OR lrt."albumArtist" LIKE '%;%'
            OR lrt."albumArtist" LIKE '%|%'
            OR lrt."albumArtist" LIKE E'%\\\\%'
            OR lrt."albumArtist" LIKE '%feat.%'
            OR lrt."albumArtist" LIKE '%feat %'
            OR lrt."albumArtist" LIKE '%ft.%'
            OR lrt."albumArtist" LIKE '%,%')
        ORDER BY lrt."albumArtist", lrt."filePath"
    ''')

    cats = {"feat": {}, "slash": {}, "semi": {}, "backslash": {}, "comma": {}}

    for r in rows:
        if len(r) < 3:
            continue
        filepath, album_artist, linked_artist = r[0], r[1], r[2]

        if album_artist.lower().strip() in BAND_NAMES:
            continue

        aa_lower = album_artist.lower()

        if "feat." in aa_lower or " feat " in aa_lower or "ft." in aa_lower:
            cats["feat"].setdefault(album_artist, []).append(filepath)
        elif "\\" in album_artist:
            cats["backslash"].setdefault(album_artist, []).append(filepath)
        elif " / " in album_artist:
            cats["slash"].setdefault(album_artist, []).append(filepath)
        elif ";" in album_artist:
            cats["semi"].setdefault(album_artist, []).append(filepath)
        elif "," in album_artist:
            if linked_artist.lower().strip() != album_artist.lower().strip():
                cats["comma"].setdefault(album_artist, []).append(filepath)

    return cats


def build_splits(cats, categories):
    """Build filepath -> [artists] mapping for the given categories."""
    splitters = {"feat": split_feat, "slash": split_slash, "semi": split_semicolon}
    splits = {}
    resync = set()

    for cat in categories:
        splitter = splitters.get(cat)
        if not splitter:
            continue
        for tag, files in cats[cat].items():
            artists = splitter(tag)
            if len(artists) < 2:
                continue
            # Skip if both sides normalize to the same name (dupes)
            unique = list(dict.fromkeys(a.strip() for a in artists))
            if len(unique) < 2:
                continue
            for fp in files:
                splits[fp] = unique
                resync.add(fp.split("/")[0])

    # Backslash entries: no tag change needed, but add to resync
    if "backslash" in categories or not categories:
        for tag, files in cats.get("backslash", {}).items():
            for fp in files:
                resync.add(fp.split("/")[0])

    return splits, sorted(resync)


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

    subprocess.run([*scp, os.path.join(SCRIPT_DIR, "fix_tags.py"), tmp,
                    f"{user}@{host}:/tmp/"], capture_output=True)
    r = subprocess.run(
        [*ssh, f"MUSIC_DIR={nas_music} python3 /tmp/fix_tags.py /tmp/dmp_fix_mapping.json --apply"],
        timeout=600,
    )
    return r.returncode == 0


def main():
    parser = argparse.ArgumentParser(description="Fix unsplit multi-artist tags")
    parser.add_argument("--apply", action="store_true", help="Apply tag fixes")
    parser.add_argument("--only", help="Fix only this category: feat, slash, semi")
    parser.add_argument("--report", action="store_true", help="Show comma entries for manual review")
    args = parser.parse_args()

    env = load_env()
    cats = find_issues(env["DATABASE_URL"])

    # Summary
    for cat in ("feat", "slash", "semi", "backslash", "comma"):
        tags = cats[cat]
        files = sum(len(v) for v in tags.values())
        label = {"feat": "feat./ft.", "slash": "` / ` (slash)", "semi": "`;` (semicolon)",
                 "backslash": "`\\` (backslash, resync only)", "comma": "`,` (skipped, needs review)"}[cat]
        print(f"  {label}: {len(tags)} unique tags, {files} files")

    fixable = sum(sum(len(v) for v in cats[c].values()) for c in ("feat", "slash", "semi"))
    print(f"\nFixable (feat + slash + semi): {fixable} files")

    if args.report:
        print("\n--- Comma entries (manual review) ---")
        for tag, files in sorted(cats["comma"].items(), key=lambda x: -len(x[1])):
            print(f"  {tag} ({len(files)} files)")
        return

    if args.apply:
        categories = [args.only] if args.only else ["feat", "slash", "semi"]
        splits, resync = build_splits(cats, categories)

        if not splits and not resync:
            print("\nNothing to fix for selected categories.")
            return

        print(f"\nApplying {len(splits)} tag changes...")
        data = {"splits": splits, "resync": resync}
        run_nas_fixer(data, env)

        print(f"\nResync commands ({len(resync)} artists):")
        for i in range(0, len(resync), 10):
            batch = resync[i:i + 10]
            print(f'  ./sync --only="{";".join(batch)}" --overwrite')
    else:
        print("\nDry run. Use --apply to fix tags, --report to review comma entries.")


if __name__ == "__main__":
    main()
