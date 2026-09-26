import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@vite-pwa/nuxt',
    '@nuxt/eslint',
  ],
  vite: {
    plugins: [tailwindcss() as any],
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'DMP',
      short_name: 'DMP',
      description: 'Personal music library',
      theme_color: '#0e0d0c',
      background_color: '#0e0d0c',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // SSR + cookie auth: navigations MUST hit the server (login redirect, per-user HTML).
      // No app-shell fallback, and never precache HTML.
      navigateFallback: undefined,
      globPatterns: ['**/*.{js,css,woff2}'],
      runtimeCaching: [
        {
          // Never cache the API: auth-protected, mutating, and audio is Range/206 (corrupts seeking).
          urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
        {
          // Album/artist artwork is immutable - safe to cache.
          urlPattern: ({ url }) => url.pathname.startsWith('/img/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'dmp-images',
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
      ],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: false,
    },
  },

  css: ['~/assets/css/main.css'],

  // The Genre Genome lab was removed (its pairwise genre-overlap graph blocked the server); keep old links working.
  routeRules: {
    '/labs/genome': { redirect: '/labs' },
  },

  runtimeConfig: {
    musicDir: process.env.MUSIC_DIR || '',
    imageDir: process.env.IMAGE_DIR || './public/img',
    imageStorage: process.env.IMAGE_STORAGE || 'local',
    remoteServerUrl: process.env.REMOTE_SERVER_URL || '',
    storagePublicUrl: process.env.STORAGE_PUBLIC_URL || '',
    public: {
      imageStorage: process.env.IMAGE_STORAGE || 'local',
      storagePublicUrl: process.env.STORAGE_PUBLIC_URL || '',
    },
  },

  app: {
    head: {
      title: 'DMP',
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'description', content: 'Personal music library: browse, play and explore your collection.' },
        { name: 'author', content: 'DMP' },
        { property: 'og:title', content: 'DMP' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'DMP' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: 'DMP' },
        { name: 'theme-color', content: '#0e0d0c' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
      script: [
        // Appearance (Settings → Themes: accent + UI size), applied before first paint. A .client
        // plugin would run after hydration, so the app would flash the defaults before the chosen
        // look landed. Kept inline, tiny and try/catch'd: localStorage throws in some privacy
        // modes, and this runs before anything else on the page. The bare-string branch reads the
        // pre-UI-size format, where the entry held just an accent id.
        {
          innerHTML: 'try{var r=localStorage.getItem("dmp-theme"),p=r&&r[0]==="{"?JSON.parse(r):{accent:r},d=document.documentElement.dataset;if(p.accent)d.theme=p.accent;if(p.size)d.size=p.size}catch(e){}',
          tagPosition: 'head',
        },
      ],
    },
  },
})
