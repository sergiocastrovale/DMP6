# Labs: World Map

World map where each country is filled with a mosaic of album cover art from artists originating from that country.

## Data Pipeline

1. **Sync** populates `Artist.country` (ISO 3166-1 alpha-2) from MusicBrainz `area.iso-3166-1-codes[0]`
2. **API** groups releases by artist country, returns up to 50 cover image refs per country
3. **Frontend** renders Leaflet.js map with GeoJSON polygons, generates canvas tile textures, fills countries progressively

## API

`GET /api/labs/map/countries` - requires auth.

Response (cached 24h in Redis):

```json
{
  "GB": {
    "name": "United Kingdom",
    "count": 42,
    "images": [
      { "image": "clxxx.jpg", "imageUrl": "https://..." },
      ...
    ]
  }
}
```

- Images capped at 200 per country
- Joins: Artist → LocalReleaseArtist → LocalRelease
- Filters: `country IS NOT NULL`, `relatedOnly = false`, has image

## Frontend Architecture

- **Map engine**: Leaflet.js with SVG renderer, no tile layer (dark background)
- **GeoJSON source**: Natural Earth 110m simplified boundaries in `web/assets/world-geojson.ts` (~276KB)
- **Zoom**: Discrete scroll/pinch zoom, 4 levels (2x–5x), pan constrained to world bounds
- **Country contours**: White, thicker for countries with data
- **Tile generation**: Offscreen `<canvas>` per country, covers in square grid (`ceil(sqrt(N))`), converted to `dataURL`, applied as `userSpaceOnUse` SVG `<pattern>` centered within country bbox. Fixed cover size (COVER_SVG px) across all countries, scales with zoom
- **Tile sizing**: All covers same size (10 SVG px at base zoom). Up to 200 images per country. No repetition - each cover once
- **One cover per artist**: API picks one random release cover per artist (not all releases)
- **Batching**: 5 countries processed concurrently to avoid overwhelming image loads
- **Progressive**: Map outlines render immediately, fills appear as textures complete
- **Empty countries**: Outline only, subtle stroke
- **Layout**: Full-page (no container/border), uses `layout: false`

## Edge Cases

- **MB pseudo-codes** (`XW` worldwide, `XE` Europe): no matching SVG country, silently ignored
- **No country on artist**: artist won't appear on map. Coverage stat shown in header
- **Tiny countries**: SVG paths exist but very small at map scale
- **Excluded countries**: `AQ` (Antarctica) and `GL` (Greenland) removed from GeoJSON source

## Refreshing Data

Re-sync artists to populate/update country field:

```bash
./sync --overwrite
```

New artists get country populated automatically during normal sync.
