# DMP V6

## Overview

DMP is a web app which combines Spotify, Plex and Lidarr, along with other archival-centric features.

In short, this app serves 4 purposes:

1. Cataloguing: process a very large local music collection (≈2 million MP3, ACC, m4a, FLAC and opus files), extract metadata, store it in a database, and reconcile it against the catalogues from MusicBrainz (MB)

2. Listening & discovery: have similar features to Spotify, with additional discovery and exploration features

3. Expanding the library: use a CLI Soulseek interface to download missing releases, then use the Beets CLI to tidy up metadata

4. Autonomous syncing: automatically update the catalogue as new releases are downloaded to the observed destination folder

The system should:

1. Parse and store local file metadata in a database (including release cover extracted from the metadata)  
2. Use MusicBrainz as the source of truth for artist discographies  
3. Compare local releases vs musicbrainz releases and assign statuses

Additionally, the system should:

- Store the type of release from MB (album, EP, compilation, etc.) and ignore irrelevant releases (singles, bootlegs, demos, unofficial releases, interviews, broadcasts)
- Store artist tags/genres from MB (e.g. "alternative rock")
- Store external links for artists from MB (official site, social media, etc.)
- Fetch the cover image for artists from Wikipedia

We will NOT attempt to "guess" any information based on folder structure, file names or any other filesystem info. Any catalogue information MUST come from either the metadata of the local files or the MusicBrainz API.

## Goals

## Phase 1: Database and Catalogue

Build the sync script and make it bullet proof.

* Syncing process

* Catalogue matching

* Status attribution

* Making sure the DB is correctly built for a subset of artists

## Phase 2: Beets integration

* Bundle the config and write docs about all necessary steps

* Create a Node script that will trigger beets for new things on the catalogue (?)

* Make sure we can re-sync properly and automatically

## Phase 3: Slsk integration

* Bundle the config and write docs about all necessary steps

* Use V5 script that will trigger slsk and download things (no web UI for now)

* See if Beets gets invoked automatically upon download

## Phase 4: Web core

* Home page (recent releases, similar to Spotify)

* Explore (refurbish old home page)

1. Search by artist name, album or track (like Spotify). The focus should be on releases, not artists (like most apps do)

2. Advanced filters could be merged with the explore page where we're listing per decade etc. but now with mood/intensity and other things

3. Varied ways of exploring the catalogue and discovering music (fully random, per genre, per decade, per mood/intensity)

* Timeline (refurbish old timeline, we can make it much better later)

## Phase 5: other web features

* Statistics

* Playlists

* Proximity map

* Reporting

Take inspiration from SongKong and build all sorts of advanced reporting about

1. Release dates

2. Release country

3. Genres, mood/intensity, bpm

4. Missing important metatags

5. Missing connection with MB, Discogs, Bandcamp

## Phase 6: Dataviz?

An area for exploration with visually mindblowing experiences.

1. Proximity map

2. World map