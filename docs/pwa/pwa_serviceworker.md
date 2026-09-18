# PWA service worker & manifest

Configured by `@vite-pwa/nuxt` in `web/nuxt.config.ts` under `pwa`. Goal: **install + icons + offline-graceful**, NOT offline browsing — this is an SSR, cookie-auth, streaming app.

## The rules (do not relax these)

DMP is SSR with httpOnly-cookie auth and Range-based audio. Default Workbox config assumes a static SPA and **will break the app** as-is. Config enforces:

1. **Never cache `/api/**`** — auth-protected, many mutate (scrobble/play counts). Audio (`/api/audio/{id}`) returns `206 Partial Content` + `Content-Range`; Cache Storage API mishandles Range/206, corrupts seeking. → `NetworkOnly` runtime rule matching `url.pathname.startsWith('/api/')`.
2. **No navigation fallback / no precached HTML** — navigations must reach the server so `auth.ts` can run its login redirect and render per-user HTML (a cached app shell would show a logged-out skeleton behind the auth wall). → `navigateFallback: undefined`, `globPatterns` restricted to `**/*.{js,css,woff2}` (no `.html`).
3. **Safe to cache:** `/img/**` artwork (immutable, `CacheFirst`), Google Fonts (`CacheFirst`), hashed build assets via precache glob.

## Verifying the build is correct

After `pnpm build`, SW lives at `web/.output/public/sw.js`:

```bash
cat web/.output/public/manifest.webmanifest
grep -oE "NetworkOnly|CacheFirst|/api/|/img/|NavigationRoute|index\.html" web/.output/public/sw.js | sort | uniq -c
```

Expected: `/api/`+`NetworkOnly` present; `/img/`+fonts present; **`NavigationRoute`/`index.html` absent**. Asserted automatically by the Playwright test (`pwa_testing.md`).

## Manifest

`name: DMP`, `display: standalone`, `theme_color`/`background_color: #000000`, `start_url: /`, `scope: /`, `orientation: portrait`. Icons referenced from `web/public/`.

## Icons

Generated from one source SVG (`web/public/pwa-icon.svg` — black rounded square + white note glyph) via `@vite-pwa/assets-generator`:

```bash
cd web && pnpm exec pwa-assets-generator --preset minimal-2023 public/pwa-icon.svg
```

Produces `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `pwa-64x64.png`. Re-run after changing the source art. `sharp` must be allowed to build (`pnpm.onlyBuiltDependencies` includes `sharp`).
