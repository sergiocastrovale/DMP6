# Deployment Guide

## Environment Variables

### Local `.env`

```env
MUSIC_DIR=/mnt/i/mp3/mainstream
DATABASE_URL=mysql://dmp4:dmp4@localhost:3306/dmp4
MANAGED=false

# Deployment configuration (read by deploy and db:update scripts)
SERVER_HOST=
SERVER_USER=
DEPLOY_PATH=/var/www/dmp
```

**Important:** `MANAGED` must be set to `false` in your local `.env` when building for production. Nuxt reads environment variables at **build time**, so the value during `pnpm build` determines what gets deployed.

### Server `.env` at `/var/www/dmp/.env` (example credentials)

```env
DATABASE_URL=mysql://dmp4:dmp4@localhost:3306/dmp4
NODE_ENV=production
NUXT_HOST=0.0.0.0
NUXT_PORT=3000
MUSIC_DIR=/var/www/dmp/music
MANAGED=false
```

### `MANAGED` Flag

The `MANAGED` environment variable controls whether management features are available:

- **`MANAGED=true`** (local development): Full access to:
  - Playlists (create, edit, delete)
  - Favorites (add, remove)
  - Settings (sources, downloader configuration)

- **`MANAGED=false`** (production server): Read-only mode:
  - All management features hidden from UI
  - Management routes blocked by middleware
  - Management API endpoints return 403 Forbidden
  - Users can only browse and play music

Environment variables are loaded from `.env` using `dotenv` in `ecosystem.config.cjs`.

### Applying Environment Variable Changes

After updating `.env`, don't forget to restart the pm2 app:

```bash
ssh [your server] "cd /path/to/project && pm2 restart [app name in pm2] --update-env"
```

## GitLab CI/CD Pipeline

The pipeline is configured in `.gitlab-ci.yml` with a single production stage that runs on every push to `main`. It's a placeholder pipeline that doesn't perform any actions on the server.

**All deployment is done locally** using the commands below.

## Deployment

To deploy from your local machine:

```bash
pnpm deploy:app
```

This command:
1. Tests SSH connection
2. Builds the Nuxt app locally (with 8GB heap allocation)
3. Syncs `.output/` directory to the server
4. Syncs `public/` directory to the server
5. Syncs `ecosystem.config.cjs` to the server
6. Restarts PM2 on the server

### Deploy Nginx Configuration

To deploy or update the Nginx configuration with caching:

```bash
pnpm deploy:nginx
```

This command:
1. Syncs `nginx-dmp.conf` to the server
2. Installs it to `/etc/nginx/sites-available/dmp`
3. Enables the site
4. Creates the cache directory
5. Tests and reloads Nginx

### SSL/HTTPS Certificate

HTTPS is configured using Let's Encrypt via Certbot:

- **Certificate**: `/etc/letsencrypt/live/discodomeuprimo.online/`
- **Auto-renewal**: Configured via systemd timer (runs twice daily)
- **Expires**: Check with `sudo certbot certificates`

To manually renew:
```bash
ssh YOUR_USER@HOST_IP "sudo certbot renew"
```

To reconfigure SSL after updating Nginx:
```bash
ssh YOUR_USER@HOST_IP "sudo certbot --nginx -d discodomeuprimo.online -d www.discodomeuprimo.online"
```

**Server directory structure:**
```
/var/www/dmp/
├── .output/              # Built Nuxt application
├── public/               # Static assets (images)
├── dump/                 # Database backups
├── .env                  # Environment variables
├── ecosystem.config.cjs  # PM2 configuration
└── node_modules/         # Only dotenv (for ecosystem config)
```

**Note:** The server does NOT have the full Git repository or source code, only the production files needed to run the app.

## Performance & Caching

The application uses a multi-layer caching strategy:

### Nginx Layer
- **Static assets** (`/img/`, favicon, robots.txt): 1 year cache, served directly from disk
- **API endpoints**: 2-10 minute cache with stale-while-revalidate
  - `/api/stats`, `/api/genres/*`, `/api/artists/basic`: 5 minutes
  - `/api/releases/latest`, `/api/releases/last-played`: 2 minutes
  - `/api/artists/[slug]`: 10 minutes
- **Cache storage**: `/var/cache/nginx/dmp` (max 1GB)

### Nuxt Layer
- Route rules defined in `nuxt.config.ts` provide server-side caching
- API responses cached in memory before reaching the database

### Clear Nginx Cache
```bash
ssh YOUR_USER@HOST_IP "sudo rm -rf /var/cache/nginx/dmp/* && sudo systemctl reload nginx"
```

## Database Restore

To restore the database from the most recent dump on the server:

```bash
pnpm deploy:db
```

This command finds the latest `.sql.gz` file in `/var/www/dmp/dump/` on the server, unzips it, and restores it to the production database.

## PM2 Configuration

PM2 uses `ecosystem.config.cjs` which loads environment variables from `.env` using `dotenv`:

```js
require('dotenv').config()

module.exports = {
  apps: [{
    name: 'dmp',
    script: './.output/server/index.mjs'
  }]
}
```

PM2 is configured to start on boot:

```bash
# View startup configuration
ssh YOUR_USER@HOST_IP "systemctl status pm2-kp"

# Manually save current PM2 process list
ssh YOUR_USER@HOST_IP "pm2 save"

# Restore saved processes
ssh YOUR_USER@HOST_IP "pm2 resurrect"
```

## Manual Deployment

If CI/CD fails, you can deploy manually:

```bash
# Build locally
pnpm install --frozen-lockfile && pnpm prisma generate && NODE_OPTIONS='--max-old-space-size=8192' nuxt build

# Deploy to server
rsync -avz --delete .output/ YOUR_USER@HOST_IP:/var/www/dmp/.output/ && ssh YOUR_USER@HOST_IP "cd /var/www/dmp && pm2 restart dmp"
```
