# TO DO

- Advanced catalogue exploration: filter by decade, mood, intensity in a unified view
- Proximity map (artists by genre/era similarity)
- World map of release origins (MusicBrainz release country)

## Labs Ideas

### Genre Relationship Graph (`/labs/genome`)
Interactive force-directed graph showing genre connections. Nodes = genres, edges = shared artists, thickness = overlap strength. Click node to list artists.
- **Data**: `Genre[]` on Artist + MusicBrainzRelease (already in DB)
- **Tech**: d3-force or vis-network for graph layout

### Streamgraph / Genre River (`/labs/timeline-river`)
Stacked area chart showing genre volume over years. Colored streams per genre, X = year, Y = release count.
- **Data**: `LocalRelease.year` + release genres via MusicBrainzRelease (already in DB)
- **Tech**: d3-shape streamgraph or visx

### Listening Habits Heatmap (`/labs/listening`)
GitHub-contribution-style grid. Days × hours, color = play intensity. Calendar view of daily listening.
- **Data**: `LocalReleaseTrack.lastPlayedAt` + `playCount` (already in DB, but only stores last played — would need a `PlayEvent` table for full history)
- **Tech**: Cal-Heatmap or custom SVG grid

### Artist Collaboration Network (`/labs/network`)
Graph of artist connections through shared tracks. Clusters reveal scenes/collaborations. Click edge → shared tracks.
- **Data**: `TrackRelatedArtist` joining artists to tracks + `LocalReleaseArtist` (already in DB)
- **Tech**: d3-force or sigma.js for large graphs

### Library Quality Dashboard (`/labs/collection-health`)
Gauges/donuts: % matched to MB, % with covers, bitrate distribution, status breakdown (COMPLETE/INCOMPLETE/MISSING), match score histogram.
- **Data**: `LocalRelease.matchStatus`, `Artist.averageMatchScore`, `LocalReleaseTrack.bitrate`, release cover existence (already in DB)
- **Tech**: Chart.js or recharts for gauges/histograms

### Decade DNA (`/labs/decades`)
Radar/polar charts comparing collection across decades — genre mix, avg track length, file quality, artist diversity per decade.
- **Data**: `LocalRelease.year`, track `duration`, `bitrate`, genres (already in DB)
- **Tech**: Chart.js radar chart or d3 polar

### Deep Cuts / Discovery (`/labs/deep-cuts`)
Surface buried gems: releases/artists with high track count but zero plays. Rank by "obscurity" within own library.
- **Data**: `LocalReleaseTrack.playCount`, `Artist.totalPlayCount`, `Artist.totalTracks` (already in DB)
- **Tech**: No extra deps, just sorting/scoring logic