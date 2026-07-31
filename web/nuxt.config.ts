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
      theme_color: '#000000',
      background_color: '#000000',
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
        {
          urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
          handler: 'CacheFirst',
          options: {
            cacheName: 'dmp-fonts',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
        { name: 'googlebot', content: 'noindex, nofollow' },
        { name: 'description', content: 'Personal music library management system combining features from Spotify, Plex, and Lidarr. Browse your collection, discover new music, and track your listening habits.' },
        { name: 'author', content: 'DMP' },
        { name: 'keywords', content: 'music library, music player, music management, music collection, digital music, music catalog, music organization, music streaming' },
        { property: 'og:title', content: 'DMP' },
        { property: 'og:description', content: 'Personal music library management system with smart catalog matching, 3D artist exploration, timeline views, and comprehensive analytics.' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'DMP' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: 'DMP' },
        { name: 'twitter:description', content: 'Personal music library management system with smart catalog matching and music discovery.' },
        { name: 'theme-color', content: '#000000' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },
})
