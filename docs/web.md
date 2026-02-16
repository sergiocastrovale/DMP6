# Web UI

Go through v5 located at `~/web/dmp`. We want to implement v6 from scratch in `/web`, with the exact same stack and libraries (updated to their newest versions), and taking a lot of inspiration from v5. 

The main goal is that we make it even cleaner, with zero redundant code, and zero spaghetti code.

## Coding style

These are critical:

* All typescript definitions should live in the web/types folder

* API should be consolidated and have a centralized pattern in server/api

* Absolutely no CSS - use Tailwind for everything

* Icones from Lucide

* Keep the database as performant as possible (it's not very good in v5) while using Prisma

## Things we do not need

- Any scripts' related code

- Any code related to the downloader

- Any code related to invoking CLI commands (downloader, syncing)

## Pages to implement

* `/browse` should look and feel exactly the same as the current `pages/index.vue`

* `/timeline` should look and feel exactly the same as the current structure in `pages/timeline`

* A new `/statistics` should display all of our `Statistics` table in a nice way

* The Spotify-like audio player should work exactly the same (you can borrow the code from v5, just make it more elegant, DRY and robust), and have the following features:

  - Add or remove favorites

  - Add or remove to playlists

  - Cycle shuffling mode: shuffle inside the current release, shuffle any track from this artist, shuffle the entire catalogue

- `/favorites` should work exactly the same

- `/playlists` should work exactly the same

- `/artist/{slug}` should work exactly the same

- We are not going to implement `/visualizers/galaxy.vue` for now

- We are not going to implement `/genres` for now