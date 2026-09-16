# "Did you know..." trivia

Trivia card on Explore (`web/components/explore/DidYouKnow.vue`), shown under the mood/era summary
panel and before the player, whenever a track is playing. Facts are sourced from Genius (artist bio,
or a release/track description) and cached in `ArtistFact` so the same subject doesn't keep
re-hitting Genius on every visit.

## Flow

`GET /api/tracks/[id]/fact` (`web/server/api/tracks/[id]/fact.get.ts`) is scoped to the track
actually playing - a specificity cascade, most specific first, stopping at the first tier with
something to show:

1. A stored `ArtistFact` about this exact track (`trackId` matches).
2. Else a stored fact about this track's release (`releaseId` matches).
3. Else a general stored fact about the artist (`artistId` matches, `releaseId`/`trackId` both null).
4. Else, if under `ARTIST_FACTS_DB_THRESHOLD` (15, `helpers/constants.ts`) stored rows for this
   artist and Genius is configured, fetch fresh (`fetchFactsForTrack()`, `server/utils/genius.ts`):
   - Genius `/search` for this exact track → matched song's `description.plain` (track tier).
   - No usable track text → the matched song's `album` → Genius `/albums/:id`
     `description_annotation` (release tier).
   - Still nothing → the matched song's `primary_artist.id` → Genius `/artists/:id`
     `description.plain` (artist tier).
   - Genius only returns songs from `/search` (no artist-name search endpoint), so every tier is
     reached by first finding *this* track on Genius, never by name lookup directly.
   - Deterministic and pinned to the one track actually playing (unlike an earlier artist-page
     version of this widget, which searched a random owned track and a random subject order) - a
     fact about a *different* song or album from the same artist would misrepresent what's on
     screen.
5. Every fact chunk extracted from that one Genius description (`extractFacts()`, paragraph then
   sentence-boundary chunking, capped at `GENIUS_FACT_MAX_CHARS`) is stored via
   `artistFact.createMany({ skipDuplicates: true })`, keyed on `hash` = sha1 of the normalized text -
   so a single fetch can seed several rows toward the threshold at once, and a description that
   hasn't changed since a prior fetch is never re-stored. The route then re-picks from whichever
   tier the fetch just populated.
6. No stored fact at any tier and nothing fetched → returns `null` and the widget doesn't render.

The route is deliberately uncached (unlike the other read endpoints) - repeat plays of the same track
can still surface a different stored fact. Genius HTTP responses themselves are cached 7 days
(`cachedResponse()` in `genius.ts`) so a low-fact artist doesn't hammer the same search/song lookup
every play while still under the threshold.

## Table

`ArtistFact` (`@@map("ArtistFacts")`): `artistId` (Cascade), optional `releaseId`/`trackId`
(Cascade — a re-indexed or deleted release/track takes its fact with it rather than orphaning into an
artist-level fact), `text`, `hash` (unique per artist, dedupe), `sourceUrl` (Genius page, shown as
attribution in the UI).

## Settings / env

Genius credentials configurable in **Settings → API Keys**: Client ID, Client Secret, Access Token.
A value set there overrides `GENIUS_CLIENT_ID` / `GENIUS_SECRET` / `GENIUS_ACCESS_TOKEN` respectively
(`server/utils/settingsCache.ts`), masked the same way as the Last.fm/S3 secrets
(`server/utils/settingsSecrets.ts`). Only the **access token** is actually used at request time
(Genius' read API is Bearer-token only) — client ID/secret are stored for reference/future OAuth use
but not currently read anywhere.

## UI

`ExploreDidYouKnow` takes the currently playing track's id as a prop, fetches client-side only
(re-fetching whenever that id changes, never blocking SSR/page load or playback - Genius can be slow
or unconfigured), and renders nothing while pending or when the API returns `null`. When shown:
title "Did you know...", the fact text, and (when present) "About '&lt;release/track title&gt;'" plus
a "via Genius" link to `sourceUrl`. Placed in `components/explore/Shell.vue` between `ExploreConfig`
(the mood/era summary) and `ExploreCard` (the player), gated on `player.explorerCurrentTrack`.
