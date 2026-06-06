import type { CapacitorConfig } from '@capacitor/cli'

// server.url is baked at build time. Set MOBILE_SERVER_URL to the HTTPS origin the app should
// load: the Cloudflare Tunnel domain (public) or the Tailscale https://<host>.<tailnet>.ts.net.
// For the CI emulator build only, point it at http://10.0.2.2:3000 (cleartext auto-enabled).
// See docs/pwa_networking.md.
const serverUrl = process.env.MOBILE_SERVER_URL

const config: CapacitorConfig = {
  appId: process.env.MOBILE_APP_ID || 'net.dmp.app',
  appName: 'DMP',
  webDir: 'www',
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith('http://'),
        androidScheme: 'https',
      }
    : undefined,
}

export default config
