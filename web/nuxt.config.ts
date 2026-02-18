import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
  ],
  vite: {
    plugins: [tailwindcss() as any],
  },

  css: ['~/assets/css/main.css'],

  nitro: {
    experimental: {
      websocket: true,
    },
    externals: {
      inline: [],
    },
  },

  runtimeConfig: {
    musicDir: process.env.MUSIC_DIR || '',
    imageStorage: process.env.IMAGE_STORAGE || 'local',
    s3PublicUrl: process.env.S3_PUBLIC_URL || '',
    mediasoupAnnouncedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '10000'),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '10100'),
    partySecret: process.env.PARTY_SECRET || '',
    public: {
      imageStorage: process.env.IMAGE_STORAGE || 'local',
      s3PublicUrl: process.env.S3_PUBLIC_URL || '',
      partyEnabled: process.env.PARTY_ENABLED === 'true',
      partyRole: process.env.PARTY_ROLE || 'host',
      partyUrl: process.env.PARTY_URL || '',
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
        { property: 'og:url', content: 'https://discodomeuprimo.online' },
        { property: 'og:site_name', content: 'DMP' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: 'DMP' },
        { name: 'twitter:description', content: 'Personal music library management system with smart catalog matching and music discovery.' },
        { name: 'theme-color', content: '#000000' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },
})
