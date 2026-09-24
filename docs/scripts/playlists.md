# Scripts: playlists

Generates or updates **genre** playlists (`PlaylistType=GENRE`) and **region** playlists
(`PlaylistType=REGION`, keyed on `Artist.country`), driven by `PlaylistGenerator` rows in the
database — edit them at `/playlists/setup/generated`, no code change or deploy needed. Genre
matching scores artists' MusicBrainz genres against each generator's keyword list.

## Build

```bash
cd scripts/playlists && cargo build --release
```

## Usage

```bash
./playlists                    # Update all playlists (genre + region)
./playlists --dry-run          # Preview without DB writes
./playlists --group rock       # Update a single generator (by its slug)
./playlists --report           # Show all genres → generator assignments
./playlists --no-genres        # Skip genre playlists (regions only)
./playlists --no-regions       # Skip region playlists (genres only)
```

## How It Works

1. Reads every `PlaylistGenerator` row from the database
2. For GENRE generators, matches DB genres against each generator's `terms` (keyword lines, `-`-prefixed exclude lines)
3. Scores artists by their best matching genre weight; for REGION generators, every artist in a listed country scores 1.0. A connected (duplicate-merged) artist is excluded from scoring either way - its own links would otherwise count it as a second artist alongside the one it was connected to.
4. Selects up to 500 tracks per group from the highest-scored artists, capped at 3 per release
5. Creates/updates a `Playlist` row (`type=GENRE`/`REGION`, linked via `generatorId`) for each generator with ≥10 selected tracks. A generator that no longer qualifies (no matches, or fewer than 10 tracks) has its existing playlist pruned instead of left stale.

## Term Syntax

A `PlaylistGenerator.terms` array is exactly what the `/playlists/setup/generated` edit page's
textarea holds, one line each:

- **GENRE**: a plain line is a keyword. A DB genre matches if it equals the keyword exactly
  (weight 1.0) or contains it as a whole word (weight 0.8, e.g. "rock" also catches "hard rock").
  A line starting with `-` excludes an exact genre name instead (e.g. `-indie rock`), checked
  before the keyword tiers. No substring tier (the old JSON config's 0.4 weight) — that produced
  too many surprising matches ("electro" catching "electronica") for a plain hand-edited list.
- **REGION**: each line is an ISO 3166-1 alpha-2 country code (e.g. `JP`), matched against
  `Artist.country`.

## Track Selection

- Artists scored by best matching genre weight across all their genres (region: uniform 1.0)
- Max 3 tracks per release to prevent one album dominating
- Within same score tier, tracks are shuffled daily (date-seeded RNG)
- Minimum 10 tracks required to create a playlist (skip otherwise)

## Report Mode

Use `--report` to see which genres map to which GENRE generators:

```
● Rock (45 genres)
    1.0 [exact] rock
    0.8 [word]  classic rock
    0.8 [word]  hard rock
    ...

○ Unmatched (12 genres)
    afrobeat
    ...
```

Use this to identify gaps and add missing genres to a generator's terms via the setup UI.

## Workflow

Run after sync to populate/refresh generated playlists:

```bash
./sync
./playlists
```

Or run report first to verify assignments:

```bash
./playlists --report
# review output, edit the relevant generator at /playlists/setup/generated
./playlists
```

## Database

Generated playlists are stored as regular `Playlist` records with:

- `type = 'GENRE'` or `'REGION'`
- `generatorId` → the `PlaylistGenerator` row that produced it (unique — one playlist per generator)
- `slug` = `genre-{generator_slug}` or `region-{generator_slug}`

Playlists are fully replaced on each run (all tracks deleted and re-inserted). Deleting a
`PlaylistGenerator` cascades to its `Playlist` (and that playlist's tracks) immediately — see
[docs/feature_generated_playlists.md](../feature_generated_playlists.md).
