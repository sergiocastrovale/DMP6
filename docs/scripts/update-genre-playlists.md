# Scripts: update-genre-playlists

Generates or updates genre-based playlists by matching artists' MusicBrainz genres against configurable genre groups with weighted proximity scoring.

## Build

```bash
cd scripts/genre-playlists && cargo build --release
```

## Usage

```bash
./update-genre-playlists                              # Update all genre playlists
./update-genre-playlists --dry-run                    # Preview without DB writes
./update-genre-playlists --group rock                 # Update single group
./update-genre-playlists --report                     # Show all genres → group assignments
./update-genre-playlists --config path/to/custom.json # Custom config file
```

## How It Works

1. Reads genre group definitions from `scripts/genre-playlists/genre-groups.json`
2. Fetches all genres from the database (sourced from MusicBrainz artist genres/tags)
3. For each group, matches genres using root keyword matching + includes/excludes
4. Scores artists by their best matching genre weight
5. Selects up to 500 tracks from highest-scored artists
6. Creates/updates `Playlist` records with `type=GENRE`

## Genre Matching

Each genre group defines:

- **roots**: Keywords for automated matching. Any DB genre containing a root as a word matches automatically.
- **includes**: Additional genre names that don't contain root keywords but belong to the group.
- **excludes**: Genre names that match a root but should be excluded from the group.

Weight tiers by match quality:

| Match Type | Weight | Example |
|-----------|--------|---------|
| Exact root | 1.0 | "rock" matches root "rock" |
| Contains root as word | 0.8 | "classic rock" contains "rock" |
| In includes list | 0.6 | "shoegaze" included in indie group |
| Contains root as substring | 0.4 | "electronica" contains "electro" |

## Track Selection

- Artists scored by best matching genre weight across all their genres
- Tracks inherit their artist's score, with +0.05 bonus if the track's own ID3 genre tag also matches
- Max 3 tracks per release to prevent one album dominating
- Within same score tier, tracks are shuffled daily (date-seeded RNG)
- Minimum 10 tracks required to create a playlist (skip otherwise)

## Config Format

`scripts/genre-playlists/genre-groups.json`:

```json
{
  "max_tracks": 500,
  "max_per_release": 3,
  "groups": [
    {
      "name": "Rock",
      "slug": "rock",
      "description": "Classic and modern rock across all subgenres",
      "roots": ["rock"],
      "includes": ["grunge", "britpop"],
      "excludes": ["post-rock", "indie rock"]
    }
  ]
}
```

## Report Mode

Use `--report` to see which genres map to which groups:

```
● Rock (45 genres)
    1.0 [exact] rock
    0.8 [word]  classic rock
    0.8 [word]  hard rock
    0.6 [include] grunge
    ...

○ Unmatched (12 genres)
    afrobeat
    ...
```

Use this to identify gaps and add missing genres to `includes` lists.

## Workflow

Run after sync to populate genre playlists:

```bash
./sync
./update-genre-playlists
```

Or run report first to verify assignments:

```bash
./update-genre-playlists --report
# review output, adjust genre-groups.json if needed
./update-genre-playlists
```

## Database

Genre playlists are stored as regular `Playlist` records with:

- `type = 'GENRE'` (vs `MANUAL` for user-created)
- `genreGroup` = the group slug (unique, used for upsert)
- `slug` = `genre-{group_slug}` (e.g., `genre-rock`)

Playlists are fully replaced on each run (all tracks deleted and re-inserted).

## Default Genre Groups

Rock, Metal, Indie, Pop, Electronic, Classical, Acoustic, Minimal, Prog, Dance, Hip-Hop, Jazz, Soul & R&B, Punk.
