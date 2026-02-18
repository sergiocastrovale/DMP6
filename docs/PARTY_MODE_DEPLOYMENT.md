# Party Mode Deployment Guide

## Overview

This guide explains how Party Mode deployment works, specifically how the deployment script automatically configures the production server as a **listener** while keeping your local development environment as a **host**.

## Key Concept

- **Local (Development)**: `PARTY_ROLE=host` - You stream audio to the remote server
- **Production (Server)**: `PARTY_ROLE=listener` - Receives audio and serves to remote listeners

The deployment script ensures the production build is always in listener mode, regardless of your local configuration.

## How It Works

### 1. Local Environment (`.env`)

Your local `.env` file has `PARTY_ROLE=host`:

```env
PARTY_ENABLED=true
PARTY_ROLE=host
PARTY_URL=https://discodomeuprimo.online
```

### 2. Build Process

When you run `pnpm deploy:app`, the script:

1. **Temporarily overrides** `PARTY_ROLE=listener` during the build
2. Builds the Nuxt app with listener mode baked into the client JavaScript
3. This ensures the production UI is read-only (no play buttons, favorites, playlists)

```typescript
// In deploy.ts
const buildEnv = { ...process.env, PARTY_ROLE: 'listener' }
execSync('pnpm build', { stdio: 'inherit', env: buildEnv })
```

### 3. Server Configuration

The script automatically creates `/var/www/dmp/.env` on the server with:

```env
# Party Mode (Listener) - Auto-configured for production
PARTY_ENABLED=true
PARTY_ROLE=listener
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=144.126.198.218  # Auto-set from SERVER_HOST
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100
```

### 4. Result

- **Local dev**: Full DMP features + Party Mode host controls
- **Production**: Read-only DMP + Auto-connects to active party sessions

## Deployment Commands

### Full Application Deployment

```bash
pnpm deploy:app
```

This command:
1. ✅ Builds with `PARTY_ROLE=listener` override
2. ✅ Syncs built files to server
3. ✅ Auto-creates server `.env` with listener config
4. ✅ Installs dependencies
5. ✅ Copies mediasoup worker binary
6. ✅ Restarts PM2

### Other Deployment Commands

```bash
# Deploy Nginx configuration
pnpm deploy:nginx

# Deploy database from local backup
pnpm deploy:db

# Clear Nginx cache
pnpm deploy:uncache

# Backup production database
pnpm backup

# Restore database locally
pnpm restore [filename]
```

## Configuration Files

### `ecosystem.config.cjs`

Simple PM2 configuration that loads `.env`:

```javascript
require('dotenv').config()

module.exports = {
  apps: [{
    name: 'dmp',
    script: './.output/server/index.mjs',
    instances: 'max',
    exec_mode: 'cluster',
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 5000,
    max_memory_restart: '500M',
  }]
}
```

**Key points:**
- Uses `dotenv` to load environment variables from `.env`
- No hardcoded environment variables
- PM2 reads from the `.env` file in the same directory

### `nginx-dmp.conf`

Nginx configuration with:
- SSL/HTTPS support
- WebSocket proxying for Party Mode (`/_ws`)
- Caching for API endpoints
- Static file serving

## Technical Details

### Why Build Locally with Listener Override?

**Problem:** Nuxt's `runtimeConfig.public` values are baked into the client JavaScript at build time. If we build with `PARTY_ROLE=host`, the production site will show host UI (play buttons, favorites, etc.).

**Solution:** Override `PARTY_ROLE=listener` during the build process so the client JavaScript contains listener mode configuration.

### Why Not Build on the Server?

Building on the server is too slow (5+ minutes) due to limited resources. Building locally takes ~10 seconds.

### Server-Side Configuration

The server plugin reads directly from `process.env` (not `useRuntimeConfig()`):

```typescript
// server/plugins/mediasoup.ts
const partyEnabled = process.env.PARTY_ENABLED === 'true'
const partyRole = process.env.PARTY_ROLE

if (!partyEnabled || partyRole !== 'listener') {
  return
}
```

This allows the server to use the correct role from the `.env` file.

### Client-Side Configuration

The client reads from `useRuntimeConfig().public.partyRole`, which is set at build time. This is why we override it during the build.

## Troubleshooting

### Production Shows Host UI (Play Buttons Visible)

**Cause:** The build was done with `PARTY_ROLE=host` instead of `listener`.

**Fix:** Redeploy with `pnpm deploy:app` (which automatically overrides to listener).

### mediasoup Worker Not Starting

**Cause:** Missing mediasoup worker binary or incorrect permissions.

**Fix:** The deploy script automatically copies the binary. Check logs:

```bash
ssh your-server 'pm2 logs dmp --lines 50'
# Should see: [mediasoup] Worker started [pid:XXXXX, ports:10000-10100]
```

### Listeners Can't Connect

**Causes:**
1. Firewall blocking UDP ports 10000-10100
2. `MEDIASOUP_ANNOUNCED_IP` incorrect

**Fix:**
```bash
# Check firewall
ssh your-server 'sudo ufw status'

# Check .env
ssh your-server 'cat /var/www/dmp/.env | grep MEDIASOUP'
```

### Database Connection Errors

**Cause:** `DATABASE_URL` not set in server `.env`.

**Fix:** Redeploy with `pnpm deploy:app` (which creates `.env` automatically).

## Files Modified for Party Mode Deployment

### New Files

- `web/ecosystem.config.cjs` - PM2 configuration with dotenv
- `web/nginx-dmp.conf` - Nginx configuration with WebSocket support
- `web/scripts/deploy.ts` - Deployment script with listener override
- `web/scripts/backup.ts` - Database backup script
- `web/scripts/restore.ts` - Database restore script
- `web/scripts/server-setup.sh` - Automated server provisioning
- `web/scripts/run-server-setup.sh` - Helper to run server setup

### Modified Files

- `web/package.json` - Added deployment scripts and moved `dotenv` to dependencies
- `web/composables/usePartyHost.ts` - Dynamic import of mediasoup-client
- `web/composables/usePartyListener.ts` - Dynamic import of mediasoup-client
- `web/server/plugins/mediasoup.ts` - Read from `process.env` instead of `useRuntimeConfig()`
- `web/.env.example` - Added deployment configuration variables

### Documentation

- `docs/music_party.md` - Updated with deployment instructions
- `docs/deploy.md` - Updated with Party Mode deployment details
- `docs/setup.md` - Updated with server setup instructions
- `docs/PARTY_MODE_DEPLOYMENT.md` - This file

## Best Practices

1. **Always use `pnpm deploy:app`** for production deployments (never build manually)
2. **Keep your local `.env` as `PARTY_ROLE=host`** (the script handles the override)
3. **Never manually edit the server's `.env`** (let the deploy script manage it)
4. **Backup before deploying database** (`pnpm backup` then `pnpm deploy:db`)
5. **Check PM2 logs after deployment** to verify mediasoup started correctly

## Security Notes

- SSH key authentication required (password auth disabled)
- Server `.env` file is auto-generated (no manual credential management)
- `PARTY_SECRET` reserved for future authentication features
- HTTPS required for WebRTC (enforced by browsers)
- Firewall configured to only allow necessary ports

## Performance

- **Build time**: ~10 seconds locally
- **Deployment time**: ~30-60 seconds (rsync + PM2 restart)
- **Server resources**: 2 CPU cores, 2GB RAM for 50+ listeners
- **Bandwidth**: ~128 kbps per listener (Opus codec)

## Future Improvements

- [ ] Build cache to speed up deployments
- [ ] Blue-green deployment for zero downtime
- [ ] Automated database migrations
- [ ] Health check endpoint for monitoring
- [ ] Rollback command for failed deployments
