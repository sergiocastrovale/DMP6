#!/usr/bin/env python3
"""
Fix compound artist tags in MP3 files on the NAS.

For each album folder listed below, reads TPE2 (album artist) and TPE1 (track artist)
tags, and if they match a known compound pattern, replaces the separator with '\\'
(backslash) which the sync script's split_artists() recognises.

Usage:
  python3 fix_compound_artists.py              # Dry run
  python3 fix_compound_artists.py --apply      # Apply fixes
"""

import os
import sys
import argparse
from pathlib import Path

try:
    from mutagen.id3 import ID3, ID3NoHeaderError, TPE1, TPE2
except ImportError:
    print("mutagen required: pip install mutagen")
    sys.exit(1)

MUSIC = os.environ.get("MUSIC_DIR", "/mnt/dmp/music/mainstream")

# Each entry: (album_folder_relative_to_MUSIC, {old_tpe2: new_tpe2}, {old_tpe1: new_tpe1} or None)
# If tpe1_map is None, apply the same mapping as tpe2.
# Use '\\' as the multi-artist separator.

FIXES = [
    # 1. Al Cohn / Bill Perkins / Richie Kamuca
    (
        "Al Cohn/Albums/1955 - Al Cohn , Bill Perkins , Richie Kamuka - The Brothers!",
        {"Al Cohn/Bill Perkins/Richie Kamuca": "Al Cohn\\Bill Perkins\\Richie Kamuca",
         "Al Cohn , Bill Perkins , Richie Kamuka": "Al Cohn\\Bill Perkins\\Richie Kamuca",
         "Al Cohn, Bill Perkins, Richie Kamuca": "Al Cohn\\Bill Perkins\\Richie Kamuca"},
        None,
    ),
    (
        "Al Cohn/Remastered/1956 - Cohn_Perkins_Kamuca - The Brothers! (Expanded Edition)",
        {"Al Cohn/Bill Perkins/Richie Kamuca": "Al Cohn\\Bill Perkins\\Richie Kamuca",
         "Cohn/Perkins/Kamuca": "Al Cohn\\Bill Perkins\\Richie Kamuca"},
        None,
    ),

    # 2. Buck Clayton-Earl Hines All-Stars (Essential Jazz Masters)
    (
        "Buck Clayton/Compilations/2011 - Essential Jazz Masters",
        {"Buck Clayton-Earl Hines All-Stars": "Buck Clayton\\Earl Hines All-Stars"},
        None,
    ),
    (
        "Buck Clayton/Compilations/2013 - Essential Jazz Masters 1960-1961",
        {"Buck Clayton-Earl Hines All-Stars": "Buck Clayton\\Earl Hines All-Stars"},
        None,
    ),

    # 3. Carlos Franzetti — path leaked into artist tag
    (
        "Carlos Franzetti/Albums/1977 - Grafitti",
        {"Carlos Franzetti\\1977 - Grafitti": "Carlos Franzetti",
         "Carlos Franzetti\\1977 - Grafitti (2007)": "Carlos Franzetti"},
        None,
    ),

    # 4. Cedar Walton / Javon Jackson / Christian McBride / Jimmy Cobb
    (
        "Cedar Walton/Albums/2006 - Cedar Walton, Javon Jackson, Christian Mcbride, Jimmy Cobb - New York Time",
        {"Cedar Walton\\Javon Jackson\\Christian Mcbride\\Jimmy Cobb": "Cedar Walton\\Javon Jackson\\Christian McBride\\Jimmy Cobb",
         "Cedar Walton, Javon Jackson, Christian Mcbride, Jimmy Cobb": "Cedar Walton\\Javon Jackson\\Christian McBride\\Jimmy Cobb",
         "Cedar Walton\\Javon Jackson\\Christian McBride\\Jimmy Cobb": "Cedar Walton\\Javon Jackson\\Christian McBride\\Jimmy Cobb"},
        None,
    ),

    # 5. Cecil Taylor-Bill Dixon-Tony Oxley
    (
        "Cecil Taylor/Albums/2002 - Cecil Taylor Bill Dixon Tony Oxley - Taylor-Dixon-Oxley",
        {"Cecil Taylor-Bill Dixon-Tony Oxley": "Cecil Taylor\\Bill Dixon\\Tony Oxley",
         "Cecil Taylor - Bill Dixon - Tony Oxley": "Cecil Taylor\\Bill Dixon\\Tony Oxley",
         "Cecil Taylor Bill Dixon Tony Oxley": "Cecil Taylor\\Bill Dixon\\Tony Oxley"},
        None,
    ),

    # 6. Chick Corea-Herbie Hancock
    (
        "Chick Corea/Albums/1978 - Corea-Hancock",
        {"Chick Corea-Herbie Hancock": "Chick Corea\\Herbie Hancock",
         "Corea-Hancock": "Chick Corea\\Herbie Hancock",
         "Chick Corea - Herbie Hancock": "Chick Corea\\Herbie Hancock"},
        None,
    ),

    # 7. Daniel.B. - ElkoB
    (
        "Daniel.B/Albums/2025 - Killmyjazz 1 - 01 - Tsukumogami 1",
        {"Daniel.B. - ElkoB": "Daniel B.\\ElkoB",
         "Daniel.B.- ElkoB": "Daniel B.\\ElkoB",
         "Daniel.B.-ElkoB": "Daniel B.\\ElkoB",
         "Daniel B. - ElkoB": "Daniel B.\\ElkoB"},
        None,
    ),

    # 8. Daniel Humair, Eddy Louiss, Jean-Luc Ponty
    (
        "Eddy Louiss/Albums/1968 - Humair, Louiss, Ponty - Trio HLP (2 CD)",
        {"Daniel Humair, Eddy Louiss, Jean-Luc Ponty": "Daniel Humair\\Eddy Louiss\\Jean-Luc Ponty",
         "Humair, Louiss, Ponty": "Daniel Humair\\Eddy Louiss\\Jean-Luc Ponty",
         "Daniel Humair - Eddy Louiss - Jean-Luc Ponty": "Daniel Humair\\Eddy Louiss\\Jean-Luc Ponty"},
        None,
    ),

    # 9. Death Cab for Cutie & Jay-Z
    (
        "Death Cab For Cutie/EPs/2006 - Retirement Plans (with Jay-Z)",
        {"Death Cab for Cutie & Jay-Z": "Death Cab for Cutie\\Jay-Z",
         "Death Cab For Cutie & Jay-Z": "Death Cab for Cutie\\Jay-Z",
         "Death Cab for Cutie & Jay Z": "Death Cab for Cutie\\Jay-Z"},
        None,
    ),

    # 10. Dizzy Gillespie - Stan Getz - Coleman Hawkins - Paul Gonsalves
    (
        "Dizzy Gillespie/Albums/1957 - Dizzy Gillespie, Stan Getz, Coleman Hawkins, Paul Gonsalves - Sittin' In (2005)",
        {"Dizzy Gillespie - Stan Getz - Coleman Hawkins - Paul Gonsalves": "Dizzy Gillespie\\Stan Getz\\Coleman Hawkins\\Paul Gonsalves",
         "Dizzy Gillespie, Stan Getz, Coleman Hawkins, Paul Gonsalves": "Dizzy Gillespie\\Stan Getz\\Coleman Hawkins\\Paul Gonsalves"},
        None,
    ),

    # 11. Floyd Jones - Eddie Taylor
    (
        "Eddie Taylor/Albums/1967 - Floyd Jones & Masters Of Modern Blues",
        {"Floyd Jones - Eddie Taylor": "Floyd Jones\\Eddie Taylor",
         "Floyd Jones & Eddie Taylor": "Floyd Jones\\Eddie Taylor",
         "Floyd Jones, Eddie Taylor": "Floyd Jones\\Eddie Taylor"},
        None,
    ),

    # 12. Garrett & Dām-Funk
    (
        "Dam-Funk/Albums/2021 - Private Life III (Garrett & D\u0101m-Funk)",
        {"Garrett & D\u0101m-Funk": "Garrett\\D\u0101m-Funk",
         "Garrett & Dam-Funk": "Garrett\\Dam-Funk",
         "Garrett & D\u0101m\u2010Funk": "Garrett\\D\u0101m-Funk"},
        None,
    ),
    (
        "Dam-Funk/Albums/2017 - Private Life (Garrett & D\u0101m-Funk)",
        {"Garrett & D\u0101m-Funk": "Garrett\\D\u0101m-Funk",
         "Garrett & Dam-Funk": "Garrett\\Dam-Funk"},
        None,
    ),
    (
        "Dam-Funk/Albums/2018 - Private Life II (Garrett & D\u0101m-Funk)",
        {"Garrett & D\u0101m-Funk": "Garrett\\D\u0101m-Funk",
         "Garrett & Dam-Funk": "Garrett\\Dam-Funk"},
        None,
    ),

    # 13. Herbie Mann-Chick Corea
    (
        "Herbie Mann/Albums/1965 - Herbie Mann, Chick Corea - Complete Latin Band Sessions (2 CD)",
        {"Herbie Mann-Chick Corea": "Herbie Mann\\Chick Corea",
         "Herbie Mann - Chick Corea": "Herbie Mann\\Chick Corea",
         "Herbie Mann, Chick Corea": "Herbie Mann\\Chick Corea"},
        None,
    ),

    # 14. Hifiklub, Duke Garwood, Jean-Michel Bossini
    (
        "Duke Garwood/Albums/2021 - Last Party on Earth (Hifiklub, Duke Garwood, Jean-Michel Bossini)",
        {"Hifiklub, Duke Garwood, Jean-Michel Bossini": "Hifiklub\\Duke Garwood\\Jean-Michel Bossini",
         "Hifiklub - Duke Garwood - Jean-Michel Bossini": "Hifiklub\\Duke Garwood\\Jean-Michel Bossini"},
        None,
    ),

    # 15. Jean-Charles Capon, Christian Escoudé
    (
        "Christian Escoude/Albums/1976 - Jean-Charles Capon, Christian Escoud\u00e9 - Les 4 \u00c9l\u00e9ments",
        {"Jean-Charles Capon, Christian Escoud\u00e9": "Jean-Charles Capon\\Christian Escoud\u00e9",
         "Jean-Charles Capon - Christian Escoud\u00e9": "Jean-Charles Capon\\Christian Escoud\u00e9",
         "Jean-Charles Capon, Christian Escoude": "Jean-Charles Capon\\Christian Escoud\u00e9"},
        None,
    ),
    (
        "Christian Escoude/Albums/1980 - Jean-Charles Capon, Christian Escoud\u00e9 - Gousti",
        {"Jean-Charles Capon, Christian Escoud\u00e9": "Jean-Charles Capon\\Christian Escoud\u00e9",
         "Jean-Charles Capon, Christian Escoude": "Jean-Charles Capon\\Christian Escoud\u00e9"},
        None,
    ),

    # 16. Joel Silbersher - Charlie Owen
    (
        "Charlie Owen/Albums/1995 - Tendrils (& Joel Silbersher)",
        {"Joel Silbersher - Charlie Owen": "Joel Silbersher\\Charlie Owen",
         "Joel Silbersher & Charlie Owen": "Joel Silbersher\\Charlie Owen",
         "Charlie Owen & Joel Silbersher": "Charlie Owen\\Joel Silbersher",
         "Joel Silbersher, Charlie Owen": "Joel Silbersher\\Charlie Owen"},
        None,
    ),

    # 17. Kiyoshi Mizutani - Daniel Menche
    (
        "Kiyoshi Mizutani/Albums/2004 - Kiyoshi Mizutani + Daniel Menche - Song Of Jike",
        {"Kiyoshi Mizutani - Daniel Menche": "Kiyoshi Mizutani\\Daniel Menche",
         "Kiyoshi Mizutani + Daniel Menche": "Kiyoshi Mizutani\\Daniel Menche",
         "Kiyoshi Mizutani, Daniel Menche": "Kiyoshi Mizutani\\Daniel Menche"},
        None,
    ),

    # 18. Laurindo Almeida - Bud Shank
    (
        "Laurindo Almeida/Albums/1953 - Brazilliance, Vol.1 (with Bud Shank)",
        {"Laurindo Almeida - Bud Shank": "Laurindo Almeida\\Bud Shank",
         "Laurindo Almeida & Bud Shank": "Laurindo Almeida\\Bud Shank",
         "Laurindo Almeida, Bud Shank": "Laurindo Almeida\\Bud Shank"},
        None,
    ),
    (
        "Laurindo Almeida/Albums/1958 - Brazilliance, Vol.2 (with Bud Shank)",
        {"Laurindo Almeida - Bud Shank": "Laurindo Almeida\\Bud Shank",
         "Laurindo Almeida & Bud Shank": "Laurindo Almeida\\Bud Shank",
         "Laurindo Almeida, Bud Shank": "Laurindo Almeida\\Bud Shank"},
        None,
    ),

    # 19. Maniac - Liles - Czral
    (
        "Andrew Liles/Albums/2009 - Det Skjedde Noe Nar Du Var I Belgia (with Maniac & Czral)",
        {"Maniac - Liles - Czral": "Maniac\\Liles\\Czral",
         "Maniac, Liles, Czral": "Maniac\\Liles\\Czral"},
        None,
    ),

    # 20. Michael Snow - Alan Licht - Aki Onda
    (
        "Aki Onda/Albums/2008 - Five A's... (with Michael Snow & Alan Licht)",
        {"Michael Snow - Alan Licht - Aki Onda": "Michael Snow\\Alan Licht\\Aki Onda",
         "Michael Snow, Alan Licht, Aki Onda": "Michael Snow\\Alan Licht\\Aki Onda"},
        None,
    ),

    # 21. Mike Bloomfield - John Hammond - Dr John (Triumvirate)
    (
        "Dr. John/Albums/1973 - Triumvirate",
        {"Mike Bloomfield - John Hammond - Dr John": "Mike Bloomfield\\John Hammond\\Dr. John",
         "Mike Bloomfield - John Hammond - Dr. John": "Mike Bloomfield\\John Hammond\\Dr. John",
         "Mike Bloomfield, John Hammond, Dr John": "Mike Bloomfield\\John Hammond\\Dr. John",
         "Mike Bloomfield, John Hammond, Dr. John": "Mike Bloomfield\\John Hammond\\Dr. John"},
        None,
    ),

    # 22. Radio-K, BARBEE BOYS
    (
        "BARBEE BOYS/Albums/1998 - Radio-K, BARBEE BOYS - JUST TWO OF US",
        {"Radio-K, BARBEE BOYS": "Radio-K\\BARBEE BOYS",
         "Radio-K & BARBEE BOYS": "Radio-K\\BARBEE BOYS"},
        None,
    ),

    # 23. Stuff Smith-Dizzy Gillespie-Oscar Peterson
    (
        "Dizzy Gillespie/Albums/1994 - Stuff Smith-Dizzy Gillespie-Oscar Peterson",
        {"Stuff Smith-Dizzy Gillespie-Oscar Peterson": "Stuff Smith\\Dizzy Gillespie\\Oscar Peterson",
         "Stuff Smith - Dizzy Gillespie - Oscar Peterson": "Stuff Smith\\Dizzy Gillespie\\Oscar Peterson"},
        None,
    ),

    # 24. The Buddy Collette-Chico Hamilton Sextet
    (
        "Chico Hamilton/Albums/1956 - Buddy Collette-Tanganyika",
        {"The Buddy Collette-Chico Hamilton Sextet": "Buddy Collette\\Chico Hamilton",
         "Buddy Collette-Chico Hamilton Sextet": "Buddy Collette\\Chico Hamilton",
         "Buddy Collette-Chico Hamilton": "Buddy Collette\\Chico Hamilton"},
        None,
    ),

    # 25. The Clifford Brown-Max Roach Quintet
    (
        "Clifford Brown/Albums/2005 - Max Roach & Clifford Brown Quintet - The Historic California Concerts (1954)",
        {"The Clifford Brown-Max Roach Quintet": "Clifford Brown\\Max Roach",
         "Clifford Brown-Max Roach Quintet": "Clifford Brown\\Max Roach",
         "Clifford Brown-Max Roach": "Clifford Brown\\Max Roach",
         "Clifford Brown - Max Roach": "Clifford Brown\\Max Roach"},
        None,
    ),
    (
        "Clifford Brown/Albums/1995 - Clifford Brown and Max Roach - Verve Jazz Masters 44",
        {"The Clifford Brown-Max Roach Quintet": "Clifford Brown\\Max Roach",
         "Clifford Brown-Max Roach Quintet": "Clifford Brown\\Max Roach",
         "Clifford Brown-Max Roach": "Clifford Brown\\Max Roach"},
        None,
    ),

    # 26. Yo-Yo Ma, Stuart Duncan, Edgar Meyer, Chris Thile
    (
        "Chris Thile/Albums/2011 - The Goat Rodeo Sessions",
        {"Yo-Yo Ma, Stuart Duncan, Edgar Meyer, Chris Thile": "Yo-Yo Ma\\Stuart Duncan\\Edgar Meyer\\Chris Thile",
         "Yo-Yo Ma, Stuart Duncan, Edgar Meyer & Chris Thile": "Yo-Yo Ma\\Stuart Duncan\\Edgar Meyer\\Chris Thile"},
        None,
    ),
    (
        "Chris Thile/Albums/2012 - The Goat Rodeo Sessions Live",
        {"Yo-Yo Ma, Stuart Duncan, Edgar Meyer, Chris Thile": "Yo-Yo Ma\\Stuart Duncan\\Edgar Meyer\\Chris Thile",
         "Yo-Yo Ma, Stuart Duncan, Edgar Meyer & Chris Thile": "Yo-Yo Ma\\Stuart Duncan\\Edgar Meyer\\Chris Thile"},
        None,
    ),

    # 27. Yo-Yo Ma - Bobby McFerrin
    (
        "Bobby McFerrin/Albums/1992 - Hush",
        {"Yo-Yo Ma - Bobby McFerrin": "Yo-Yo Ma\\Bobby McFerrin",
         "Yo-Yo Ma, Bobby McFerrin": "Yo-Yo Ma\\Bobby McFerrin",
         "Yo-Yo Ma & Bobby McFerrin": "Yo-Yo Ma\\Bobby McFerrin"},
        None,
    ),

    # 28. Wyman, Bill [bass ex-Rolling Stones] → Bill Wyman
    (
        "Bill Wyman's Rhythm Kings/Albums/1992 - Stuff",
        {"Wyman, Bill [bass ex-Rolling Stones]": "Bill Wyman",
         "Wyman, Bill": "Bill Wyman"},
        None,
    ),

    # 29. Duke Ellington and the Buck Clayton All-Stars at Newport
    (
        "Buck Clayton/Albums/1956 - Duke Ellington and The Buck Clayton All-Stars - At Newport",
        {"Duke Ellington and the Buck Clayton All-Stars at Newport": "Duke Ellington\\Buck Clayton All-Stars",
         "Duke Ellington And The Buck Clayton All-Stars At Newport": "Duke Ellington\\Buck Clayton All-Stars",
         "Duke Ellington and The Buck Clayton All-Stars": "Duke Ellington\\Buck Clayton All-Stars"},
        None,
    ),

    # 30. Cochise — TPE2 has track numbers instead of artist name
    (
        "Cochise/Albums/1971 - Swallow Tales",
        {"01": "Cochise", "02": "Cochise", "03": "Cochise", "04": "Cochise",
         "05": "Cochise", "06": "Cochise", "07": "Cochise", "08": "Cochise",
         "09": "Cochise", "10": "Cochise", "11": "Cochise", "12": "Cochise"},
        {},  # Don't touch TPE1
    ),

    # 31. Elis Regina — TPE2 has track numbers instead of artist name
    (
        "Elis Regina/Albums/1973 - Elis",
        {"01": "Elis Regina", "02": "Elis Regina", "03": "Elis Regina",
         "04": "Elis Regina", "05": "Elis Regina", "06": "Elis Regina",
         "07": "Elis Regina", "08": "Elis Regina", "09": "Elis Regina",
         "10": "Elis Regina", "11": "Elis Regina", "12": "Elis Regina"},
        {},  # Don't touch TPE1
    ),

    # 32. Dirty Looks — TPE2 has track numbers instead of artist name
    (
        "Dirty Looks/Albums/2007 - Gasoline",
        {"01": "Dirty Looks", "02": "Dirty Looks", "03": "Dirty Looks",
         "04": "Dirty Looks", "05": "Dirty Looks", "06": "Dirty Looks",
         "07": "Dirty Looks", "08": "Dirty Looks", "09": "Dirty Looks",
         "10": "Dirty Looks", "11": "Dirty Looks", "12": "Dirty Looks",
         "13": "Dirty Looks"},
        {},  # Don't touch TPE1
    ),
]


def find_mp3s(folder):
    mp3s = []
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith(".mp3"):
                mp3s.append(os.path.join(root, f))
    return mp3s


def fix_tag(tags, frame_key, FrameClass, old_val, new_val, dry_run):
    """Fix a single tag value. Returns True if changed."""
    current = tags.get(frame_key)
    if not current:
        return False

    current_text = str(current)
    if current_text.strip() == old_val:
        if not dry_run:
            tags.delall(frame_key)
            tags.add(FrameClass(encoding=3, text=[new_val]))
        return True
    return False


def process_folder(folder_path, tpe2_map, tpe1_map, dry_run):
    """Process all MP3s in a folder, applying tag fixes."""
    mp3s = find_mp3s(folder_path)
    if not mp3s:
        return 0, 0

    fixed = 0
    skipped = 0

    for path in mp3s:
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            skipped += 1
            continue
        except Exception as e:
            print(f"  ERROR reading {path}: {e}")
            skipped += 1
            continue

        changed = False
        tpe2_val = str(tags.get("TPE2", "")).strip()
        tpe1_val = str(tags.get("TPE1", "")).strip()

        # Fix TPE2
        effective_tpe2_map = tpe2_map or {}
        for old, new in effective_tpe2_map.items():
            if tpe2_val == old:
                if dry_run:
                    print(f"  [DRY] TPE2: '{old}' -> '{new}'")
                    print(f"         {os.path.basename(path)}")
                else:
                    tags.delall("TPE2")
                    tags.add(TPE2(encoding=3, text=[new]))
                changed = True
                break

        # Fix TPE1 — use tpe1_map if provided, otherwise apply same map as tpe2
        effective_tpe1_map = tpe1_map if tpe1_map is not None else effective_tpe2_map
        for old, new in effective_tpe1_map.items():
            if tpe1_val == old:
                if dry_run:
                    print(f"  [DRY] TPE1: '{old}' -> '{new}'")
                else:
                    tags.delall("TPE1")
                    tags.add(TPE1(encoding=3, text=[new]))
                changed = True
                break

        if changed:
            if not dry_run:
                tags.save()
            fixed += 1
        else:
            skipped += 1

    return fixed, skipped


def diagnose_featured(folder_path):
    """For folders with 'Feat.' issues, show what TPE1/TPE2 actually contain."""
    mp3s = find_mp3s(folder_path)
    if not mp3s:
        return

    print(f"  Diagnosing tags in {len(mp3s)} files:")
    tpe1_vals = set()
    tpe2_vals = set()
    for path in mp3s[:5]:  # sample
        try:
            tags = ID3(path)
            t1 = str(tags.get("TPE1", "")).strip()
            t2 = str(tags.get("TPE2", "")).strip()
            tpe1_vals.add(t1)
            tpe2_vals.add(t2)
        except Exception:
            pass

    print(f"  TPE1 values: {tpe1_vals}")
    print(f"  TPE2 values: {tpe2_vals}")


def main():
    parser = argparse.ArgumentParser(description="Fix compound artist MP3 tags")
    parser.add_argument("--apply", action="store_true", help="Apply fixes (default: dry run)")
    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run:
        print("=== DRY RUN (use --apply to fix) ===\n")
    else:
        print("=== APPLYING FIXES ===\n")

    total_fixed = 0
    total_skipped = 0
    missing_folders = []

    for folder_rel, tpe2_map, tpe1_map in FIXES:
        folder_path = os.path.join(MUSIC, folder_rel)

        if not os.path.isdir(folder_path):
            missing_folders.append(folder_rel)
            continue

        print(f"--- {folder_rel}")

        if not tpe2_map:
            # Diagnostic only (Cochise, Elis Regina, Dirty Looks)
            diagnose_featured(folder_path)
            print()
            continue

        fixed, skipped = process_folder(folder_path, tpe2_map, tpe1_map, dry_run)
        total_fixed += fixed
        print(f"  Fixed: {fixed}, Skipped: {skipped}\n")

    print("=" * 60)
    print(f"Total fixed: {total_fixed}")
    if missing_folders:
        print(f"\nMissing folders ({len(missing_folders)}):")
        for f in missing_folders:
            print(f"  - {f}")

    if dry_run:
        print("\nRun with --apply to apply changes.")


if __name__ == "__main__":
    main()
