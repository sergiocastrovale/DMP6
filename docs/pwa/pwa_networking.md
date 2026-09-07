# Networking: reaching the backend over HTTPS

A PWA needs a **secure context** (HTTPS or localhost) for the service worker, MediaSession, and
Capacitor `server.url`. A bare `http://192.168.x.x:3000` or `http://100.x.x.x:3000` (raw
Tailscale IP) is **not** a secure context → no install, no SW. Always go through one of the HTTPS
origins below. Both are supported and can run at the same time.

## Cloudflare Tunnel (public, any network)

Already present in `docker-compose.yml` (the `cloudflared` service). Gives a public
`https://<your-domain>` reachable from **anywhere with no client app** — best for "several
devices anywhere". DMP stays behind its own cookie auth (`server/middleware/auth.ts`); optionally
add Cloudflare Access in front for a second layer.

## Tailscale (private, tailnet only)

`tailscale serve` publishes the container with a valid Let's Encrypt cert via MagicDNS:

```bash
tailscale serve --bg http://localhost:3000
# → https://<host>.<tailnet>.ts.net
```

Reachable only by devices on the tailnet (Tailscale installed + logged in). No public exposure,
and LAN-fast.

## Which origin does the native APK use?

`server.url` is **baked into the Capacitor build** (see
[pwa_capacitor_android.md](./pwa_capacitor_android.md)). Drive it with an env var and build two
variants:

| APK | `MOBILE_SERVER_URL` | Use |
|-----|---------------------|-----|
| `dmp-public.apk` | Cloudflare domain | works on any network — recommended default |
| `dmp-tailnet.apk` | `https://<host>.<tailnet>.ts.net` | private-only |

The browser-installed PWA needs no variants — it uses whatever origin the user visits.

## Cookie / secure-context checklist

- Reach the app only via an HTTPS origin so `dmp_session` keeps its `Secure` flag.
- `NODE_ENV=production` must be set on the container (the cookie's `Secure` flag is gated on it in
  `web/server/api/auth/login.post.ts`).
- `sameSite: 'lax'` is correct for both transports — the WebView/PWA origin equals the cookie
  origin (same-site). No `SameSite=None`/CORS needed precisely because we load the remote origin
  directly rather than a cross-origin SPA.

## Gotcha

Changing the baked origin (renaming the Tailscale host, or changing the Cloudflare domain)
requires **rebuilding and reinstalling** that APK variant. Pin the hostname.
