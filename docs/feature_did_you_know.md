# "Did you know..." artist trivia

Trivia card on the artist page (`web/components/artist/DidYouKnow.vue`), between the header and the
status filter chips. Facts are sourced from Genius (artist bio, or a release/track description) and
cached in `ArtistFact` so the same artist doesn't keep re-hitting Genius on every visit.

## Flow

`GET /api/artists/[slug]/fact` (`web/server/api/artists/[slug]/fact.get.ts`):

1. Count stored `ArtistFact` rows for the artist.
2. If `count > ARTIST_FACTS_DB_THRESHOLD` (15, `helpers/constants.ts`) **or** Genius isn't
   configured → skip Genius entirely, serve a random stored row (or `null` if none exist yet).
3. Otherwise pick a random subject (`artist` / `release` / `track`, `pickSubject()` in
   `server/utils/geniusFacts.ts`) and fetch from Genius (`fetchArtistFacts()`,
   `server/utils/genius.ts`):
   - **track**: Genius `/search` for one of the artist's own local tracks → matched song's
     `description.plain`.
   - **release**: same song lookup → its `song.album` → Genius `/albums/:id`
     `description_annotation`.
   - **artist**: the matched song's `primary_artist.id` → Genius `/artists/:id` `description.plain`.
   - Genius only returns songs from `/search` (no artist-name search endpoint), so every subject is
     reached by first finding one of the artist's tracks on Genius, never by name lookup directly.
   - If the requested subject has no usable text, falls through the other two (artist last, since a
     bio is the one most likely to exist) so one visit still yields something whenever Genius has
     anything at all for this artist.
4. Every fact chunk extracted from that one Genius description (`extractFacts()`, paragraph then
   sentence-boundary chunking, capped at `GENIUS_FACT_MAX_CHARS`) is stored via
   `artistFact.createMany({ skipDuplicates: true })`, keyed on `hash` = sha1 of the normalized text —
   so a single fetch can seed several rows toward the threshold at once, and a description that
   hasn't changed since a prior fetch is never re-stored.
5. Returns a random stored row (whatever was just inserted, or whatever already existed).

The route is deliberately uncached (unlike the other `/api/artists/[slug]/*` routes) — the whole
point is a different fact on repeat visits. Genius HTTP responses themselves are cached 7 days
(`cachedResponse()` in `genius.ts`) so a low-fact artist doesn't hammer the same search/song lookup
every visit while still under the threshold.

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

`ArtistDidYouKnow` fetches client-side only (`onMounted`, never blocks SSR/page load — Genius can be
slow or unconfigured) and renders nothing while pending or when the API returns `null`. When shown:
title "Did you know...", the fact text, and (when present) "About '&lt;release/track title&gt;'" plus
a "via Genius" link to `sourceUrl`.
