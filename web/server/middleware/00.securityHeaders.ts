import { buildSecurityHeaders } from '~/server/utils/securityHeaders'

// Named 00.* so it runs before auth.ts: a redirect or 401 from the auth middleware still carries the headers.
export default defineEventHandler((event) => {
  const { storagePublicUrl } = useRuntimeConfig()
  setResponseHeaders(event, buildSecurityHeaders({ dev: import.meta.dev, storagePublicUrl }))
})
