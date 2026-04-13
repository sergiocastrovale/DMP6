#!/usr/bin/env python3
"""
Fix artist name issues across the library and clean up orphaned DB data.

Three modes (all run by default):

  corrupted   — garbage in TPE2: track numbers, years, paths, bitrate markers.
                Derives correct albumArtist from DB signals (majority vote,
                linked artists, folder consensus, artist tag).

  separators  — compound artist names with &, /, feat. that should be split.
                Validates against MusicBrainz: skip confirmed single artists,
                split only when parts are confirmed separate MB artists.

  cleanup     — remove orphan artists, empty releases, orphan MB data,
                phantom numeric artists with stale links.

Usage:
    python3 scripts/fix_artist_names.py                      # dry run (all modes)
    python3 scripts/fix_artist_names.py --apply              # apply all fixes
    python3 scripts/fix_artist_names.py --only=corrupted     # only garbage TPE2
    python3 scripts/fix_artist_names.py --only=separators    # only compound splitting
    python3 scripts/fix_artist_names.py --cleanup            # only DB cleanup
    python3 scripts/fix_artist_names.py --skip-mb            # skip MusicBrainz validation

Requires: mutagen (on the machine where files live)
Optional: boto3 (for S3 image deletion — skipped if not installed)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

MB_API = "https://musicbrainz.org/ws/2"
MB_USER_AGENT = "DMP-FixArtistNames/1.0 (https://github.com/dmp)"
MB_DELAY = 1.0        # base delay between requests (seconds)
MB_MAX_RETRIES = 5    # max retries on 503/429
MB_CACHE_FILE = "/tmp/dmp_mb_cache.json"

_mb_cache = {}        # name -> bool (is real artist)
_last_mb_request = 0
_mb_delay = 1.0       # adaptive delay (adjusts on success/failure)
_mb_consecutive_503 = 0  # circuit breaker counter


def load_mb_cache(clear_unknowns=False):
    """Load MB cache from disk. With clear_unknowns=True, drop None entries so they're retried."""
    global _mb_cache
    try:
        with open(MB_CACHE_FILE) as f:
            raw = json.load(f)
        if clear_unknowns:
            _mb_cache = {k: v for k, v in raw.items() if v is not None}
            cleared = len(raw) - len(_mb_cache)
            if cleared:
                print(f"  Loaded MB cache: {len(_mb_cache)} resolved, {cleared} unknowns cleared for retry")
        else:
            _mb_cache = raw
            print(f"  Loaded MB cache: {len(_mb_cache)} entries")
    except (FileNotFoundError, json.JSONDecodeError):
        _mb_cache = {}


def save_mb_cache():
    """Persist MB cache to disk."""
    with open(MB_CACHE_FILE, "w") as f:
        json.dump(_mb_cache, f, indent=2)

# Known single artists whose names contain separator characters.
# Fast pre-filter before MB API calls — MB validation is the real safety net.
KNOWN_SINGLE_ARTISTS = {
    # Slash
    "ac/dc", "gza/genius", "joy/disaster", "mats/morgan", "manna/mirage",
    "maurizio bianchi / m.b.", "d/a a/d", "+/-",
    # Ampersand — bands/projects, not collaborations
    "simon & garfunkel", "kool & the gang", "belle & sebastian",
    "sly & the family stone", "zeal & ardor", "bob & earl",
    "emerson, lake & palmer", "earth, wind & fire",
    "blood, sweat & tears", "crosby, stills & nash",
    "crosby, stills, nash & young", "the reds, pinks & purples",
    "mcguinn, clark & hillman", "carney, hild & kramer",
    "tom tom club", "chad & jeremy", "sam & dave",
    "ike & tina turner", "daryl hall & john oates",
    "booker t. & the m.g.'s", "derek & the dominos",
    "dj jazzy jeff & the fresh prince", "milli vanilli",
    "tears for fears", "hall & oates",
    "y & t", "gerry & the pacemakers", "catfish & the bottlemen",
    "aaron west & the roaring twenties", "mumford & sons",
    "angels & airwaves", "angus & julia stone", "aly & aj",
    "amadou & mariam", "andy & lucas", "archie bell & the drells",
    "big & rich", "bebe & cece winans", "brooks & dunn",
    "hootie & the blowfish", "joan jett & the blackhearts",
    "judah & the lion", "maps & atlases", "of mice & men",
    "nick cave & the bad seeds", "sharon jones & the dap-kings",
    "st. paul & the broken bones", "for king & country",
    "frank carter & the rattlesnakes", "george thorogood & the destroyers",
    "the war and treaty", "seals & crofts", "zager & evans",
    "shovels & rope", "fujiya & miyagi", "godley & creme",
    "blank & jones", "niki & the dove", "oscar & the wolf",
    "the king khan & bbq show", "the king khan & his shrines",
    "the moth & the flame", "the howl & the hum",
    "the brooklyn, bronx & queens band", "the devil & the universe",
    "crime & the city solution", "xutos & pontapés",
    "método de stravinsky", "panda bear & sonic boom",
    "savath & savalas", "polo & pan", "blu & exile",
    "andy frasco & the u.n", "zapp & roger", "ian & sylvia",
    "peter & gordon", "ivan & alyosha", "jan & dean",
    "bekka & billy", "shannon & the clams", "shannon and the clams",
    "mo lowda & the humble", "sweet & lynch", "method man & redman",
    "strunz & farah", "dailey & vincent", "doyle lawson & quicksilver",
    "lukas nelson & promise of the real", "tyler bryant & the shakedown",
    "robert jon & the wreck", "jason elmore & hoodoo witch",
    "mike mains & the branches", "jake dunn & the blackbirds",
    "teresa james & the rhythm tramps", "micky & the motorcars",
    "sean riley & the slowriders", "kiko king & creativemaze",
    "santos & pecadores", "peste & sida", "chitãozinho & xororó",
    "pedro abrunhosa & os bandemónio", "wisin y yandel",
    "soziedad alkohólika",
    # Artist & backing band patterns (should not split)
    "ronnie earl & the broadcasters", "gladys knight & the pips",
    "ziggy marley & the melody makers", "sam cooke & the soul stirrers",
    "alison krauss & union station", "stephen malkmus & the jicks",
    "steve harley & cockney rebel", "roger chapman & the shortlist",
    "omar & the howlers", "gerry rafferty & stealers wheel",
    "acid mothers temple & the cosmic inferno",
    "acid mothers temple & the melting paraiso u.f.o.",
    "arnaldo & patrulha do espaço",
    "billy the kid & the regulators",
    "chris farlowe & the thunderbirds",
    "dave alvin & the guilty men",
    "del mccoury & the dixie pals",
    "gene vincent & the blue caps",
    "george jones & the jones boys",
    "gerry mulligan & the concert jazz band",
    "kinky friedman & the texas jewboys",
    "larry coryell & the eleventh house",
    "paul kelly & the coloured girls",
    "shane mcgowan & the popes",
    "shooter jennings & the .357's",
    "smelll & quim", "smell & quim",
    "wildcat o'halloran & his band",
    "kc & sunshine band",
    # Comma
    "hank williams, jr.", "hank williams, jr",
    "nothing,nowhere.", "albert hammond, jr", "albert hammond, jr.",
    "an ancient legend, long forgotten", "right away, great captain!",
    "slaughter beach, dog", "loney, dear", "goodnight, texas",
    "weddings, parties, anything", "black country, new road",
    "dream, ivory", "invent, animate", "allo, darlin'",
}


# ── MusicBrainz validation ────────────────────────────────────────────────

def mb_artist_exists(name):
    """Check if an artist name exists on MusicBrainz. Returns True/False/None.
    Results are cached. Adaptive rate limiting with retry on 503/429.
    Circuit breaker: after 5 consecutive 503s, pauses 30s before continuing."""
    global _last_mb_request, _mb_delay, _mb_consecutive_503

    if name in _mb_cache:
        return _mb_cache[name]

    # Circuit breaker — if MB has been consistently 503, do a long pause
    if _mb_consecutive_503 >= 5:
        print(f"  MB circuit breaker: {_mb_consecutive_503} consecutive 503s "
              f"— pausing 30s", file=sys.stderr)
        time.sleep(30)
        _mb_consecutive_503 = 0
        _mb_delay = 2.0  # reset to safe delay

    query = urllib.parse.quote(f'artist:"{name}"')
    url = f'{MB_API}/artist/?query={query}&fmt=json&limit=5'

    for attempt in range(MB_MAX_RETRIES):
        # Rate limit
        elapsed = time.time() - _last_mb_request
        if elapsed < _mb_delay:
            time.sleep(_mb_delay - elapsed)

        req = urllib.request.Request(url, headers={"User-Agent": MB_USER_AGENT})
        try:
            _last_mb_request = time.time()
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())

            # Success — decrease delay (min 0.8s), reset circuit breaker
            _mb_delay = max(0.8, _mb_delay * 0.9)
            _mb_consecutive_503 = 0

            artists = data.get("artists", [])
            for a in artists:
                mb_name = a.get("name", "")
                score = a.get("score", 0)
                if score < 80:
                    continue
                if mb_name.lower() == name.lower():
                    _mb_cache[name] = True
                    return True
                if score >= 90 and name.lower() in mb_name.lower():
                    _mb_cache[name] = True
                    return True

            _mb_cache[name] = False
            return False

        except urllib.error.HTTPError as e:
            if e.code in (503, 429) and attempt < MB_MAX_RETRIES - 1:
                _mb_delay = min(5.0, _mb_delay * 1.5)
                wait = min(10.0, 2.0 * (attempt + 1))
                print(f"  MB {e.code} for '{name}' — waiting {wait:.0f}s "
                      f"(attempt {attempt + 1}/{MB_MAX_RETRIES})",
                      file=sys.stderr)
                time.sleep(wait)
                continue
            _mb_consecutive_503 += 1
            _mb_cache[name] = None
            return None

        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < MB_MAX_RETRIES - 1:
                _mb_delay = min(5.0, _mb_delay * 1.5)
                wait = min(10.0, 2.0 * (attempt + 1))
                print(f"  MB timeout for '{name}' — waiting {wait:.0f}s "
                      f"(attempt {attempt + 1}/{MB_MAX_RETRIES})",
                      file=sys.stderr)
                time.sleep(wait)
                continue
            _mb_consecutive_503 += 1
            _mb_cache[name] = None
            return None

        except json.JSONDecodeError as e:
            print(f"  MB bad response for '{name}': {e}", file=sys.stderr)
            _mb_cache[name] = None
            return None

    _mb_consecutive_503 += 1
    _mb_cache[name] = None
    return None


# ── DB helpers ─────────────────────────────────────────────────────────────

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


def exec_db(db_url, sql):
    return subprocess.run(
        ["psql", db_url, "-c", sql],
        capture_output=True, text=True, timeout=60,
    )


# ── Shared helpers ─────────────────────────────────────────────────────────

def is_bad_value(val):
    """Return True if a string looks like a corrupted albumArtist / artist name."""
    if not val or not val.strip():
        return True
    v = val.strip()
    if re.match(r'^\d{1,3}$', v):
        return True
    if re.match(r'^\d{1,3}\s*-\s*\w', v):
        return True
    if re.match(r'^\d{4}\s*-\s*.+\s+-\s+.+\s+-\s+', v):
        return True
    if re.search(r'@\d{2,3}$', v):
        return True
    return False


def is_likely_year(val, year):
    if not val or not year:
        return False
    return val.strip() == str(year)


# ── Mode 1: Corrupted albumArtist ─────────────────────────────────────────

def find_corrupted_issues(db_url, skip_mb=False):
    """Find tracks with garbage in albumArtist and determine corrections."""

    bad_rows = query_db(db_url, r'''
        SELECT t.id, t."filePath", t."albumArtist", t.artist,
               COALESCE(CAST(t.year AS TEXT), ''),
               COALESCE(CAST(t."localReleaseId" AS TEXT), '')
        FROM "LocalReleaseTrack" t
        WHERE
            t."albumArtist" ~ '^\d{1,3}$'
            OR t."albumArtist" ~ '^\d{1,3}\s*-\s*\w'
            OR t."albumArtist" ~ '^\d{4}\s*-\s*.+\s+-\s+.+\s+-\s+'
            OR (t.year IS NOT NULL AND t."albumArtist" = CAST(t.year AS TEXT))
            OR t."albumArtist" ~ '@\d{2,3}$'
        ORDER BY t."filePath"
    ''')

    releases = {}
    for r in bad_rows:
        if len(r) < 6:
            continue
        td = {
            'id': r[0], 'filepath': r[1], 'album_artist': r[2] or '',
            'artist': r[3] or '', 'year': r[4], 'release_id': r[5],
        }
        releases.setdefault(td['release_id'], []).append(td)

    if not releases:
        return {}, []

    skipped = []
    release_ids_sql = ",".join(f"'{rid}'" for rid in releases)

    # All albumArtist values per release
    all_aa_rows = query_db(db_url, f'''
        SELECT "localReleaseId", "albumArtist", COUNT(*) as cnt
        FROM "LocalReleaseTrack"
        WHERE "localReleaseId" IN ({release_ids_sql})
        GROUP BY "localReleaseId", "albumArtist"
        ORDER BY "localReleaseId", cnt DESC
    ''')
    release_aa = {}
    for r in all_aa_rows:
        if len(r) < 3:
            continue
        rid, aa, cnt = r[0], r[1] or '', int(r[2])
        release_aa.setdefault(rid, []).append((aa, cnt))

    # Linked artists per release
    linked_rows = query_db(db_url, f'''
        SELECT lra."localReleaseId", a.name, a."musicbrainzId",
               (SELECT COUNT(*) FROM "TrackArtist" ta WHERE ta."artistId" = a.id) as tc
        FROM "LocalReleaseArtist" lra
        JOIN "Artist" a ON a.id = lra."artistId"
        WHERE lra."localReleaseId" IN ({release_ids_sql})
        ORDER BY lra."localReleaseId", tc DESC
    ''')
    release_artists = {}
    for r in linked_rows:
        if len(r) < 4:
            continue
        rid, name, mb_id, tc = r[0], r[1], r[2] or '', int(r[3])
        release_artists.setdefault(rid, []).append((name, mb_id, tc))

    # Folder consensus
    folder_artists = {}
    folders_needed = set()
    for tracks in releases.values():
        for td in tracks:
            top = td['filepath'].split('/')[0] if '/' in td['filepath'] else ''
            if top:
                folders_needed.add(top)

    if folders_needed:
        folder_clauses = " OR ".join(
            f"t.\"filePath\" LIKE '{f.replace(chr(39), chr(39)+chr(39))}/%'"
            for f in folders_needed
        )
        folder_rows = query_db(db_url, f'''
            SELECT split_part(t."filePath", '/', 1) as folder,
                   t."albumArtist", COUNT(*) as cnt
            FROM "LocalReleaseTrack" t
            WHERE ({folder_clauses})
              AND t."albumArtist" !~ '^\\d{{1,3}}$'
              AND t."albumArtist" !~ '^\\d{{1,3}}\\s*-\\s*\\w'
              AND t."albumArtist" !~ '@\\d{{2,3}}$'
              AND (t.year IS NULL OR t."albumArtist" != CAST(t.year AS TEXT))
            GROUP BY folder, t."albumArtist"
            ORDER BY folder, cnt DESC
        ''')
        folder_candidates = {}
        for r in folder_rows:
            if len(r) >= 3:
                folder, aa, cnt = r[0], r[1], int(r[2])
                if not is_bad_value(aa):
                    folder_candidates.setdefault(folder, []).append((aa, cnt))
        for folder, candidates in folder_candidates.items():
            for aa, cnt in candidates:
                if aa.lower() == folder.lower():
                    folder_artists[folder] = aa
                    break
            if folder in folder_artists:
                continue
            for aa, cnt in candidates:
                if folder.lower() in aa.lower():
                    folder_artists[folder] = aa
                    break
            if folder in folder_artists:
                continue
            if candidates:
                folder_artists[folder] = candidates[0][0]

    # Resolve corrections
    fixes = {}
    unresolved = []

    for release_id, bad_tracks in releases.items():
        sample_path = bad_tracks[0]['filepath']
        top_folder = sample_path.split('/')[0] if '/' in sample_path else ''
        folder_aa = folder_artists.get(top_folder)

        if not skip_mb:
            original_aa = bad_tracks[0]['album_artist'].strip()
            if re.match(r'^\d{1,4}$', original_aa):
                result = mb_artist_exists(original_aa)
                if result is True:
                    print(f"  ✓ '{original_aa}' confirmed as real MB artist — skipping")
                    for td in bad_tracks:
                        skipped.append(td['filepath'])
                    continue

        correct = _resolve_albumartist(
            release_id, bad_tracks,
            release_aa.get(release_id, []),
            release_artists.get(release_id, []),
            folder_aa,
        )

        if not correct:
            unresolved.append((release_id, bad_tracks))
            continue

        if not skip_mb:
            parts = re.split(r'[\\&]', correct)
            all_valid = True
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                result = mb_artist_exists(part)
                if result is False:
                    print(f"  ✗ Proposed correction '{part}' not found on MB — skipping release")
                    all_valid = False
                    break
            if not all_valid:
                continue

        sample_aa = bad_tracks[0]['album_artist'].strip()
        if correct.startswith(sample_aa + ' ') or correct.startswith(sample_aa + '('):
            continue

        for td in bad_tracks:
            if td['album_artist'].strip() != correct:
                fixes[td['filepath']] = correct

    if unresolved:
        for release_id, bad_tracks in unresolved:
            aa = bad_tracks[0]['album_artist'].strip()
            tc_rows = query_db(db_url, f'''
                SELECT COUNT(*) FROM "TrackArtist" ta
                JOIN "Artist" a ON a.id = ta."artistId"
                WHERE a.name = '{aa.replace("'", "''")}'
            ''')
            tc = int(tc_rows[0][0]) if tc_rows and tc_rows[0] else 0

            if tc >= 20:
                if not skip_mb:
                    result = mb_artist_exists(aa)
                    if result is True:
                        for td in bad_tracks:
                            skipped.append(td['filepath'])
                        continue
                else:
                    for td in bad_tracks:
                        skipped.append(td['filepath'])
                    continue

            sample = bad_tracks[0]
            print(f"  ⚠ Cannot resolve: albumArtist='{aa}' in {sample['filepath']}")
            print(f"    (artist tag='{sample['artist']}', {len(bad_tracks)} tracks, tc={tc})")

    return fixes, skipped


def _resolve_albumartist(release_id, bad_tracks, all_aa, linked_artists,
                         folder_albumartist=None):
    """Pick the correct albumArtist for a release using DB signals."""
    for aa, cnt in all_aa:
        if not is_bad_value(aa) and not is_likely_year(aa, bad_tracks[0].get('year')):
            return aa

    real = []
    for name, mb_id, tc in linked_artists:
        if is_bad_value(name):
            continue
        if tc >= 3:
            real.append((name, tc))

    if real:
        real.sort(key=lambda x: -x[1])
        names = [n for n, _ in real[:3]]
        return '\\'.join(names)

    if folder_albumartist:
        return folder_albumartist

    artist_counts = {}
    for td in bad_tracks:
        a = td['artist'].strip()
        if a and not is_bad_value(a):
            cleaned = re.sub(r'[^\x20-\x7e]+$', '', a).strip()
            if cleaned:
                artist_counts[cleaned] = artist_counts.get(cleaned, 0) + 1

    if artist_counts:
        best = max(artist_counts, key=artist_counts.get)
        return best

    return None


# ── Mode 2: Compound artist separators ─────────────────────────────────────

def _split_one(name):
    """Split a single name by one separator level. Returns (type, parts) or (None, [name])."""
    # feat. / ft. variants (highest priority)
    m = re.split(r'\s*[\[\(]?(?:feat\.?|ft\.)\s*[\]\)]?\s*', name, flags=re.IGNORECASE)
    if len(m) > 1:
        parts = [p.strip().strip('[](),').strip() for p in m if p.strip()]
        if len(parts) > 1:
            return ('feat', parts)

    # Spaced slash first, then bare
    if ' / ' in name:
        parts = [p.strip() for p in name.split(' / ') if p.strip()]
        if len(parts) > 1:
            return ('slash', parts)
    if '/' in name:
        parts = [p.strip() for p in name.split('/') if p.strip()]
        if len(parts) > 1 and all(len(p) >= 2 for p in parts):
            return ('slash', parts)

    # Spaced ampersand first, then bare
    if ' & ' in name:
        parts = [p.strip() for p in name.split(' & ') if p.strip()]
        if len(parts) > 1:
            return ('ampersand', parts)
    if '&' in name:
        parts = [p.strip() for p in name.split('&') if p.strip()]
        if len(parts) > 1 and all(len(p) >= 2 for p in parts):
            return ('ampersand', parts)

    # Comma (only if ALL parts contain a space — avoids "Last, First" and single-word lists)
    if ', ' in name:
        parts = [p.strip() for p in name.split(', ') if p.strip()]
        if len(parts) > 1 and all(' ' in p for p in parts):
            return ('comma', parts)

    return (None, [name])


def detect_and_split(name):
    """Detect separators recursively. Returns (primary_type, flat_parts) or (None, [])."""
    sep_type, parts = _split_one(name)
    if sep_type is None:
        return (None, [])

    # Recursively split each part — cascading separators
    primary_type = sep_type
    final_parts = []
    for part in parts:
        sub_type, sub_parts = _split_one(part)
        if sub_type is not None:
            final_parts.extend(sub_parts)
        else:
            final_parts.append(part)

    # Filter out empty/tiny parts
    final_parts = [p for p in final_parts if p and len(p) >= 2]

    if len(final_parts) > 1:
        return (primary_type, final_parts)
    return (None, [])


def find_separator_issues(db_url, skip_mb=False):
    """Find compound artists that should be split into separate artists."""

    rows = query_db(db_url, r'''
        SELECT DISTINCT a.id, a.name
        FROM "Artist" a
        WHERE a.name LIKE '%&%'
           OR a.name LIKE '%/%'
           OR a.name ILIKE '%feat.%'
           OR a.name ILIKE '%feat %'
           OR a.name ILIKE '%ft.%'
        ORDER BY a.name
    ''')

    if not rows:
        return {}, {}, {}

    # Categorise candidates
    candidates = {'ampersand': [], 'slash': [], 'feat': []}
    for r in rows:
        if len(r) < 2:
            continue
        artist_id, name = r[0], r[1]
        sep_type, parts = detect_and_split(name)
        if sep_type and len(parts) > 1:
            candidates[sep_type].append((artist_id, name, parts))

    counts = {k: len(v) for k, v in candidates.items()}
    print(f"  Candidates: {counts.get('ampersand', 0)} (&), "
          f"{counts.get('slash', 0)} (/), {counts.get('feat', 0)} (feat.)")

    # Pre-filter known single artists
    pre_filtered = 0
    filtered = {'ampersand': [], 'slash': [], 'feat': []}
    for sep_type, entries in candidates.items():
        for artist_id, name, parts in entries:
            if name.lower() in KNOWN_SINGLE_ARTISTS:
                pre_filtered += 1
                continue
            filtered[sep_type].append((artist_id, name, parts))

    if pre_filtered:
        print(f"  Pre-filtered: {pre_filtered} known single artists")

    # MB validation
    verdicts = {'single': 0, 'compound': 0, 'unknown': 0}
    splits = {}  # filepath -> [artist1, artist2, ...]
    compound_artists = []  # for display: (name, parts, file_count)

    all_entries = []
    for sep_type, entries in filtered.items():
        for entry in entries:
            all_entries.append((sep_type, *entry))

    total = len(all_entries)
    for i, (sep_type, artist_id, name, parts) in enumerate(all_entries):
        if not skip_mb:
            # Phase A: is the full name a single MB artist?
            full_result = mb_artist_exists(name)
            if full_result is True:
                verdicts['single'] += 1
                continue

            # Phase B: check each split part
            confirmed = 0
            for part in parts:
                result = mb_artist_exists(part)
                if result is True:
                    confirmed += 1

            # Split if >50% of parts confirmed
            if confirmed <= len(parts) / 2:
                verdicts['unknown'] += 1
                continue

        verdicts['compound'] += 1

        # Find all files for this artist
        file_rows = query_db(db_url, f'''
            SELECT DISTINCT lrt."filePath", lrt."albumArtist"
            FROM "LocalReleaseTrack" lrt
            JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
            JOIN "Artist" a ON a.id = lra."artistId"
            WHERE a.id = '{artist_id}'
              AND lrt."albumArtist" IS NOT NULL
        ''')

        file_count = 0
        for fr in file_rows:
            if len(fr) >= 2:
                filepath, current_aa = fr[0], fr[1]
                # Only fix if current albumArtist matches the compound name
                if current_aa.strip().lower() == name.lower():
                    splits[filepath] = parts
                    file_count += 1

        if file_count > 0:
            compound_artists.append((name, parts, file_count))

    return splits, verdicts, compound_artists


# ── Mode 3: Cleanup ────────────────────────────────────────────────────────

def delete_s3_images(keys, env):
    if not keys:
        return 0
    bucket = env.get("S3_IMAGE_BUCKET", "dmp-img")
    region = env.get("AWS_REGION", "eu-north-1")
    try:
        s3 = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=env.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=env.get("AWS_SECRET_ACCESS_KEY"),
        )
        deleted = 0
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            objects = [{"Key": k} for k in batch]
            s3.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
            deleted += len(batch)
        return deleted
    except Exception as e:
        print(f"  S3 error: {e}")
        return 0


def delete_local_images(filenames, env):
    project_root = env.get("PROJECT_ROOT", PROJECT_ROOT)
    if project_root.startswith("~"):
        project_root = os.path.expanduser(project_root)
    img_dir = os.path.join(project_root, "web", "public", "img", "artists")
    deleted = 0
    for name in filenames:
        path = os.path.join(img_dir, name)
        if os.path.exists(path):
            os.remove(path)
            deleted += 1
    return deleted


def run_cleanup(db_url, env, dry_run=True):
    """Remove orphaned DB data: phantom artists, orphan artists, MB releases, empty releases."""
    image_storage = env.get("IMAGE_STORAGE", "local")
    use_s3 = image_storage in ("s3", "both")
    use_local = image_storage in ("local", "both")

    # --- Phantom artists (numeric names with stale links) ---
    phantoms = query_db(db_url, r'''
        SELECT DISTINCT a.id, a.name FROM "Artist" a
        JOIN "TrackArtist" ta ON ta."artistId" = a.id
        JOIN "LocalReleaseTrack" t ON t.id = ta."trackId"
        WHERE (a.name ~ '^\d{1,3}$'
               OR a.name ~ '^\d{1,3}\s*-\s*\w'
               OR a.name ~ '^\d{4}\s*-\s*.+\s+-\s+.+\s+-\s+'
               OR a.name ~ '@\d{2,3}$')
          AND t."albumArtist" != a.name
          AND t."albumArtist" !~ '^\d{1,3}$'
    ''')
    print(f"  Phantom artists (stale links): {len(phantoms)}")
    if phantoms and not dry_run:
        ids = [r[0] for r in phantoms]
        id_list = ",".join(f"'{i}'" for i in ids)
        exec_db(db_url, f'DELETE FROM "TrackArtist" WHERE "artistId" IN ({id_list})')
        exec_db(db_url, f'DELETE FROM "LocalReleaseArtist" WHERE "artistId" IN ({id_list})')
        print(f"    Removed stale links for {len(phantoms)} phantom artist(s)")

    # --- Orphan artists ---
    orphans = query_db(db_url, '''
        SELECT a.id, a.name, a.image FROM "Artist" a
        WHERE NOT EXISTS (
            SELECT 1 FROM "LocalReleaseArtist" lra
            JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lra."localReleaseId"
            WHERE lra."artistId" = a.id
        )
    ''')
    print(f"  Orphan artists: {len(orphans)}")

    if orphans and not dry_run:
        s3_keys = []
        local_filenames = []
        for row in orphans:
            img = row[2] if len(row) > 2 and row[2] else None
            if img:
                s3_keys.append(f"artists/{img}")
                local_filenames.append(img)

        if use_s3 and s3_keys:
            if HAS_BOTO3:
                count = delete_s3_images(s3_keys, env)
                print(f"    Deleted {count} S3 image(s)")
            else:
                print(f"    Skipping {len(s3_keys)} S3 image(s) (boto3 not installed)")

        if use_local and local_filenames:
            count = delete_local_images(local_filenames, env)
            if count:
                print(f"    Deleted {count} local image(s)")

        ids = [row[0] for row in orphans]
        id_list = ",".join(f"'{i}'" for i in ids)
        for table, col in [
            ("LocalReleaseArtist", "artistId"),
            ("TrackArtist", "artistId"),
            ("ArtistUrl", "artistId"),
            ("_ArtistGenres", "A"),
            ("MusicBrainzReleaseArtist", "artistId"),
            ("Artist", "id"),
        ]:
            exec_db(db_url, f'DELETE FROM "{table}" WHERE "{col}" IN ({id_list})')
        print(f"    Removed {len(orphans)} artist(s)")

    # --- Orphan MB releases ---
    mb_orphans = query_db(db_url, '''
        SELECT COUNT(*) FROM "MusicBrainzRelease"
        WHERE id NOT IN (SELECT "releaseId" FROM "MusicBrainzReleaseArtist")
    ''')
    mb_count = int(mb_orphans[0][0]) if mb_orphans else 0
    print(f"  Orphan MB releases: {mb_count}")

    if mb_count > 0 and not dry_run:
        exec_db(db_url, '''
            DELETE FROM "MusicBrainzReleaseTrack" WHERE "releaseId" IN (
                SELECT id FROM "MusicBrainzRelease"
                WHERE id NOT IN (SELECT "releaseId" FROM "MusicBrainzReleaseArtist")
            )
        ''')
        exec_db(db_url, '''
            DELETE FROM "MusicBrainzRelease"
            WHERE id NOT IN (SELECT "releaseId" FROM "MusicBrainzReleaseArtist")
        ''')
        print(f"    Removed {mb_count} MB release(s)")

    # --- Empty local releases ---
    empty = query_db(db_url, '''
        SELECT COUNT(*) FROM "LocalRelease"
        WHERE NOT EXISTS (
            SELECT 1 FROM "LocalReleaseTrack" WHERE "localReleaseId" = "LocalRelease".id
        )
    ''')
    empty_count = int(empty[0][0]) if empty else 0
    print(f"  Empty releases: {empty_count}")

    if empty_count > 0 and not dry_run:
        exec_db(db_url, '''
            DELETE FROM "LocalReleaseArtist" WHERE "localReleaseId" IN (
                SELECT id FROM "LocalRelease"
                WHERE NOT EXISTS (
                    SELECT 1 FROM "LocalReleaseTrack"
                    WHERE "localReleaseId" = "LocalRelease".id
                )
            )
        ''')
        exec_db(db_url, '''
            DELETE FROM "LocalRelease"
            WHERE NOT EXISTS (
                SELECT 1 FROM "LocalReleaseTrack"
                WHERE "localReleaseId" = "LocalRelease".id
            )
        ''')
        print(f"    Removed {empty_count} release(s)")

    # --- Update statistics ---
    if not dry_run:
        exec_db(db_url, '''
            UPDATE "Statistics" SET
                artists = (SELECT COUNT(*) FROM "Artist")::int,
                "updatedAt" = NOW()
            WHERE id = 'main'
        ''')


# ── NAS tag fixer ──────────────────────────────────────────────────────────

def run_nas_fixer(data, env):
    """Send tag fixes to NAS via SSH, or apply locally if MUSIC_DIR is accessible."""
    music_dir = env.get("MUSIC_DIR", "")
    local_accessible = os.path.isdir(music_dir)
    fix_tags_script = os.path.join(SCRIPT_DIR, "fix_tags.py")

    tmp = "/tmp/dmp_fix_artist_names.json"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)

    if local_accessible:
        r = subprocess.run(
            [sys.executable, fix_tags_script, tmp, "--apply"],
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
    nas_json = "/tmp/dmp_fix_artist_names.json"

    subprocess.run([*scp, fix_tags_script, tmp,
                    f"{user}@{host}:/tmp/"], capture_output=True)
    r = subprocess.run(
        [*ssh, f"MUSIC_DIR={nas_music} python3 /tmp/fix_tags.py {nas_json} --apply"],
        timeout=7200,
    )
    return r.returncode == 0


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fix artist name issues and clean up DB")
    parser.add_argument("--apply", action="store_true", help="Apply fixes (default: dry run)")
    parser.add_argument("--skip-mb", action="store_true", help="Skip MusicBrainz validation")
    parser.add_argument("--only", choices=["corrupted", "separators"],
                        help="Run only one tag-fix mode")
    parser.add_argument("--cleanup", action="store_true",
                        help="Run only DB cleanup (no tag fixes)")
    parser.add_argument("--retry-unknowns", action="store_true",
                        help="Load MB cache from previous run, clear unknowns, retry only those")
    args = parser.parse_args()

    env = load_env()
    db_url = env.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL not set")

    dry_run = not args.apply

    # Load MB cache (persisted across runs)
    if not args.skip_mb:
        load_mb_cache(clear_unknowns=args.retry_unknowns)

    print("DMP Artist Name Fixer")
    print("=====================\n")

    corruption_fixes = {}
    separator_splits = {}
    all_resync_folders = set()

    if args.cleanup:
        # Cleanup-only mode
        print("── Cleanup ──")
        run_cleanup(db_url, env, dry_run=dry_run)
        print()
        if dry_run:
            print("Dry run. Use --apply to clean DB.")
        else:
            print("Done.")
        return

    # ── Mode 1: Corrupted ──
    if not args.only or args.only == "corrupted":
        print("── Corrupted albumArtist ──")
        corruption_fixes, corrupted_skipped = find_corrupted_issues(
            db_url, skip_mb=args.skip_mb)

        if corrupted_skipped:
            print(f"  Skipped {len(corrupted_skipped)} tracks (confirmed real MB artist)")

        if corruption_fixes:
            folders = {}
            for fp, correct in corruption_fixes.items():
                parts = fp.split('/')
                folder_key = '/'.join(parts[:3]) if len(parts) >= 3 else '/'.join(parts[:-1])
                if folder_key not in folders:
                    folders[folder_key] = {'correct': correct, 'files': []}
                folders[folder_key]['files'].append(fp)

            print(f"\n  Found {len(corruption_fixes)} files in {len(folders)} folders:")
            for folder, info in sorted(folders.items()):
                print(f"    {folder}/")
                print(f"      {len(info['files'])} files → albumArtist = \"{info['correct']}\"")

            all_resync_folders.update(fp.split('/')[0] for fp in corruption_fixes)
        else:
            print("  No corrupted albumArtist found.")
        print()

    # ── Mode 2: Separators ──
    if not args.only or args.only == "separators":
        print("── Compound artist separators ──")
        separator_splits, verdicts, compound_artists = find_separator_issues(
            db_url, skip_mb=args.skip_mb)

        if verdicts:
            print(f"  MB validation: {verdicts.get('single', 0)} single, "
                  f"{verdicts.get('compound', 0)} compound, "
                  f"{verdicts.get('unknown', 0)} unknown")

        if compound_artists:
            print(f"\n  Compound artists to split ({len(compound_artists)}):")
            for name, parts, fc in sorted(compound_artists):
                print(f"    {name} → {' \\\\ '.join(parts)} ({fc} files)")

            all_resync_folders.update(fp.split('/')[0] for fp in separator_splits)
        else:
            print("  No compound artists to split.")

        # Persist cache so --retry-unknowns can pick up where we left off
        if not args.skip_mb:
            save_mb_cache()
        print()

    # ── Summary ──
    total_fixes = len(corruption_fixes) + len(separator_splits)
    resync_folders = sorted(all_resync_folders)

    if total_fixes == 0:
        print("No tag fixes needed.")
    else:
        print(f"Total: {total_fixes} files to fix.")

    if not dry_run and total_fixes > 0:
        # Build combined payload
        data = {"resync": resync_folders}

        if corruption_fixes:
            data["mapping"] = corruption_fixes

        if separator_splits:
            data["splits"] = {fp: parts for fp, parts in separator_splits.items()}

        print(f"\nApplying {total_fixes} fixes...")
        success = run_nas_fixer(data, env)

        if success:
            print("\nTag fixes applied.")
        else:
            print(f"\nFixes saved to /tmp/dmp_fix_artist_names.json")
            print(f"Apply manually: MUSIC_DIR=... python3 scripts/fix_tags.py "
                  f"/tmp/dmp_fix_artist_names.json --apply")

    # ── Cleanup (always runs with --apply) ──
    if not dry_run:
        print("\n── Cleanup ──")
        run_cleanup(db_url, env, dry_run=False)

    # ── Resync command ──
    if resync_folders:
        print(f'\nResync command:')
        print(f'  ./sync --only="{";".join(resync_folders)}" --overwrite')

    print()
    if dry_run:
        msg = "Dry run."
        if total_fixes > 0:
            msg += " Use --apply to fix tags and clean DB."
        print(msg)
    else:
        print("Done.")


if __name__ == "__main__":
    main()
