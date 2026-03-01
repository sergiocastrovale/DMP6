# Scripts: sync

Fetches MusicBrainz data, matches releases, downloads artist images.

## Build

Scripts auto-build on first run. To build manually:

```bash
cd scripts/sync && cargo build --release
```

### Usage

```bash
# Sync artists that need it
./sync

# Re-sync all artists
./sync --overwrite

# Sync specific artist
./sync --only="Radiohead"

# Sync range of artists
./sync --from="A" --to="M"

# Sync with limit
./sync --limit=10

# Combined filters
./sync --only="Radio" --overwrite
./sync --from="A" --to="D" --limit=100
```

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--overwrite` | false | Re-sync all artists (including already synced ones) |
| `--only PREFIX` | | Only sync artists starting with prefix (case insensitive) |
| `--from PREFIX` | | Sync artists starting from prefix (case insensitive) |
| `--to PREFIX` | | Sync artists up to prefix (case insensitive) |
| `--limit N` | 0 (no limit) | Limit to first N artists |
| `--verbose` | false | Show skipped releases (singles, bootlegs, etc.) in output |

### How it works

For each artist that needs syncing (no `musicbrainzId`, or `lastSyncedAt` older than 30 days, or `--overwrite` flag):

1. **Compound name detection**: If the artist name contains multi-artist delimiters (`/`, `;`, `,`, `feat.`, `ft.`), it is skipped with a warning. These are leftover compound names that should be resolved by re-indexing with the updated indexer (which splits them into individual artists). Artists that already have a `musicbrainzId` are not affected by this check.
2. **Search** MusicBrainz for the artist (by name or existing MB ID) — see [Artist Matching](#artist-matching) below
   - **Note**: "Various Artists" is automatically skipped (compilation marker, not a real artist)
3. **Fetch** complete discography (release groups)
4. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
5. **Create** MusicBrainzRelease and MusicBrainzReleaseTrack records
6. **Store** genres/tags and artist URLs
7. **Download** artist image (Wikipedia/Wikidata first, then Fanart.tv; 200x200 JPEG)
8. **Status check** per release:
   - `COMPLETE` - All MB tracks found locally
   - `INCOMPLETE` - Some tracks missing locally
   - `EXTRA_TRACKS` - More local tracks than MB
   - `MISSING` - MB release not in local catalogue
   - `UNSYNCABLE` - No MB ID on local release
   - `UNKNOWN` - Has MB ID but not found online
9. **Calculate** `averageMatchScore` per artist
10. Set `musicbrainzId` and `lastSyncedAt`

### Artist Matching

MusicBrainz is queried using a quoted phrase (`artist:"Name"`) and a score + similarity check. A result is accepted only if the MB score is ≥ 90 **and** the names are similar enough.

**Similarity check**: both names are normalised (lowercased, leading "the " stripped, punctuation removed), then compared using word-level Jaccard similarity (≥ 50% word overlap). Single-token names require an exact match to prevent e.g. "3" matching "Alabama 3".

When the stored artist name doesn't match, three fallback strategies are tried in order:

1. **`artist` tag** — look up the raw `artist` field from a sample track. If it differs from the stored name, try it as a search term.
2. **Split `albumArtist`** — split the raw `albumArtist` tag by each separator below (in order), try every resulting piece:

   | Separator | Example |
   |-----------|---------|
   | `, ` | `Real Recognize Rio, 21 Lil Harold` → tries `Real Recognize Rio`, then `21 Lil Harold` |
   | ` & ` | `070 Shake & Christine and the Queens` → tries `070 Shake` |
   | ` vs ` | `Band A vs Band B` → tries `Band A` |
   | ` vs. ` | `…and Oceans vs. Bloodthorn` → tries `…and Oceans` |
   | ` feat ` | `Artist feat Other` → tries `Artist` |
   | ` feat. ` | `Artist feat. Other` → tries `Artist` |
   | ` – ` | `Hävok Ünit – andOceans – The Sin:Decay` → tries `Hävok Ünit` |

   The first piece that matches on MB wins. Real compound bands (e.g. "Kool & The Gang") succeed in step 1 and never reach the split logic.

### Rate Limiting

Adaptive strategy to respect MusicBrainz API limits:
- Starts at 1s between requests
- Doubles delay on 503/429 responses (up to 10s base)
- Reduces delay by 15% on success (back down to 1s minimum)
- Retries up to 10 times per request with exponential backoff (up to 60s per retry)

### Error Logging

All sync errors are logged to `errors.log` (project root):
- Each error is prefixed with `[SYNC]`
- Errors include: artist search failures, release fetch failures, DB errors, API errors
- Errors are non-fatal; syncing continues with next artist
- Example: `[SYNC] No MusicBrainz match for artist: Unknown Band`