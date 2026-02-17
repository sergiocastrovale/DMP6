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
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      htmlAttrs: {
        class: 'dark',
      },
    },
  },
})
