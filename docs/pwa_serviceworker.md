# PWA service worker & manifest

Configured by `@vite-pwa/nuxt` in `web/nuxt.config.ts` under the `pwa` key. The goal is
**install + icons + offline-graceful**, NOT offline browsing — this is an SSR, cookie-auth,
streaming app.

## The rules (do not relax these)

DMP is SSR with httpOnly-cookie auth and Range-based audio. The default Workbox config assumes a
static SPA and **will break the app** if applied as-is. The config enforces:

1. **Never cache `/api/**`.** These are auth-protected and many mutate (scrobble / play counts).
   Audio (`/api/audio/{id}`) returns `206 Partial Content` with `Content-Range`; the Cache
   Storage API mishandles Range/206 and corrupts seeking. → handled by a `NetworkOnly` runtime
   rule matching `url.pathname.startsWith('/api/')`.
2. **No navigation fallback / no precached HTML.** Navigations must reach the server so
   `server/middleware/auth.ts` can run its login redirect and render per-user HTML. A cached app
   shell would show a logged-out skeleton behind the auth wall. → `navigateFallback: undefined`
   and `globPatterns` restricted to `**/*.{js,css,woff2}` (no `.html`).
3. **Safe to cache:** `/img/**` artwork (immutable, `CacheFirst`), Google Fonts (`CacheFirst`),
   and hashed build assets via the precache glob.

## Verifying the build is correct

After `pnpm build`, the generated SW lives at `web/.output/public/sw.js`:

```bash
# manifest present and correct
cat web/.output/public/manifest.webmanifest

# the contract: /api NetworkOnly, /img + fonts CacheFirst, NO NavigationRoute/index.html
grep -oE "NetworkOnly|CacheFirst|/api/|/img/|NavigationRoute|index\.html" web/.output/public/sw.js | sort | uniq -c
```

Expected: `/api/` + `NetworkOnly` present; `/img/` + fonts present; **`NavigationRoute` and
`index.html` absent.** This is asserted automatically by the Playwright test (see
[pwa_testing.md](./pwa_testing.md)).

## Manifest

`name: DMP`, `display: standalone`, `theme_color`/`background_color: #000000`, `start_url: /`,
`scope: /`, `orientation: portrait`. Icons are referenced from `web/public/`.

## Icons

Generated from a single source SVG (`web/public/pwa-icon.svg` — black rounded square + white
note glyph) with `@vite-pwa/assets-generator`:

```bash
cd web && pnpm exec pwa-assets-generator --preset minimal-2023 public/pwa-icon.svg
```

Produces `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`,
`apple-touch-icon-180x180.png`, `pwa-64x64.png`. Re-run after changing the source art.
`sharp` must be allowed to build (`pnpm.onlyBuiltDependencies` includes `sharp`).
