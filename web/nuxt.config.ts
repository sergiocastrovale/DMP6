import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    musicDir: process.env.MUSIC_DIR || '',
    imageStorage: process.env.IMAGE_STORAGE || 'local',
    s3PublicUrl: process.env.S3_PUBLIC_URL || '',
    public: {
      imageStorage: process.env.IMAGE_STORAGE || 'local',
      s3PublicUrl: process.env.S3_PUBLIC_URL || '',
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
