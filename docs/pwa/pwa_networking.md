# Networking: reaching the backend over HTTPS

A PWA needs a **secure context** (HTTPS or localhost) for the service worker, MediaSession, Capacitor `server.url`. A bare `http://192.168.x.x:3000` or raw Tailscale IP is **not** secure → no install, no SW. Always go through one of the HTTPS origins below — both can run at once.

## Cloudflare Tunnel (public, any network)

Already in `docker-compose.yml` (`cloudflared` service). Public `https://<your-domain>` reachable from anywhere, no client app — best for "several devices anywhere". Behind DMP's own cookie auth (`server/middleware/auth.ts`); optionally add Cloudflare Access as a second layer.

## Tailscale (private, tailnet only)

```bash
tailscale serve --bg http://localhost:3000
# → https://<host>.<tailnet>.ts.net
```
Valid Let's Encrypt cert via MagicDNS. Reachable only by tailnet devices. No public exposure, LAN-fast.

## Which origin does the native APK use?

`server.url` is **baked into the Capacitor build** (`pwa_capacitor_android.md`) via env var — build two variants:

| APK | `MOBILE_SERVER_URL` | Use |
|-----|---------------------|-----|
| `dmp-public.apk` | Cloudflare domain | works on any network — recommended default |
| `dmp-tailnet.apk` | `https://<host>.<tailnet>.ts.net` | private-only |

Browser-installed PWA needs no variants — uses whatever origin the user visits.

## Cookie / secure-context checklist

- Reach the app only via HTTPS so `dmp_session` keeps its `Secure` flag.
- `NODE_ENV=production` must be set (gates `Secure` in `login.post.ts`).
- `sameSite: 'lax'` correct for both transports — WebView/PWA origin equals cookie origin (same-site), no `SameSite=None`/CORS needed since we load the remote origin directly rather than a cross-origin SPA.

## Gotcha

Changing the baked origin (renamed Tailscale host, changed Cloudflare domain) requires **rebuilding and reinstalling** that APK variant. Pin the hostname.
