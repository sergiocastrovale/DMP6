// Response security headers for every route, HTML documents included. Pure so the CSP text is
// unit-testable; server/middleware/00.securityHeaders.ts applies it.
//
// 'unsafe-inline' for scripts is deliberate: Nuxt inlines its hydration payload, and nuxt.config.ts ships
// a tiny inline theme bootstrap that has to run before first paint. Nonces would need a per-request
// render hook and buy little for a private, no-user-content app - the CSP's job here is to stop
// framing, off-origin loads and plugin content, not to be a full XSS backstop.
export interface SecurityHeaderOptions {
  // Vite's dev server needs eval and a websocket, so the CSP is left off there.
  dev: boolean
  // Public origin of the S3/CDN image bucket (STORAGE_PUBLIC_URL), when covers are served from it.
  storagePublicUrl?: string
}

const originOf = (url: string | undefined): string | null => {
  if (!url) {
    return null
  }
  try {
    return new URL(url).origin
  }
  catch {
    return null
  }
}

export const buildCsp = (options: Pick<SecurityHeaderOptions, 'storagePublicUrl'>): string => {
  const storage = originOf(options.storagePublicUrl)
  const directives: Record<string, string[]> = {
    'default-src': ['\'self\''],
    'script-src': ['\'self\'', '\'unsafe-inline\''],
    'style-src': ['\'self\'', '\'unsafe-inline\'', 'https://fonts.googleapis.com'],
    'font-src': ['\'self\'', 'https://fonts.gstatic.com'],
    // https: because cover art can come from an S3/CDN bucket or (Cover Art Archive) URLs stored on the row.
    'img-src': ['\'self\'', 'data:', 'blob:', 'https:'],
    'media-src': ['\'self\'', 'blob:'],
    'connect-src': ['\'self\'', ...(storage ? [storage] : [])],
    'worker-src': ['\'self\''],
    'manifest-src': ['\'self\''],
    'object-src': ['\'none\''],
    'base-uri': ['\'self\''],
    'form-action': ['\'self\''],
    'frame-ancestors': ['\'none\''],
  }
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

export const buildSecurityHeaders = (options: SecurityHeaderOptions): Record<string, string> => ({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  ...(options.dev ? {} : { 'Content-Security-Policy': buildCsp(options) }),
})
