# Deployment Guide

## Environment Variables

### Local `.env`

Your local `.env` file should include deployment configuration:

```env
# Music directory (local only)
MUSIC_DIR=/path/to/your/music

# Database (local development)
DATABASE_URL=postgresql://user:pass@localhost:5432/dmp6

# Image Storage (S3)
IMAGE_STORAGE=s3
S3_BUCKET=your-bucket
S3_REGION=your-region
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_PUBLIC_URL=https://your-bucket.s3.region.amazonaws.com

# Deployment Configuration
SERVER_HOST=your-server-ip
SERVER_USER=root
DEPLOY_PATH=/var/www/dmp
SSH_KEY_PATH=~/.ssh/your_key

# Server Setup (for initial provisioning)
DEPLOY_DOMAIN=your-domain.com
DEPLOY_DB_NAME=dmp6
DEPLOY_DB_USER=dmp6
DEPLOY_DB_PASSWORD=secure-password

# Party Mode (Host Configuration)
PARTY_ENABLED=true
PARTY_ROLE=host  # Local is host, production is listener
PARTY_URL=https://your-domain.com

# mediasoup WebRTC (for production server)
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100
```

### Server `.env` (Auto-Generated)

The server's `.env` file at `/var/www/dmp/.env` is **automatically created** by `pnpm deploy:app`. It will contain:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/dmp6

# Image Storage
IMAGE_STORAGE=s3
S3_BUCKET=your-bucket
S3_REGION=your-region
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_PUBLIC_URL=https://your-bucket.s3.region.amazonaws.com

# Party Mode (Listener) - Auto-configured for production
PARTY_ENABLED=true
PARTY_ROLE=listener  # Forced by deploy script
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=your-server-ip  # Auto-set from SERVER_HOST
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100
```

**Key Points:**
- `PARTY_ROLE` is **always set to `listener`** on the server (regardless of your local setting)
- `MEDIASOUP_ANNOUNCED_IP` is **automatically set** to your `SERVER_HOST` value
- All other variables are copied from your local `.env`

### Applying Environment Variable Changes

If you manually edit the server's `.env` file, restart PM2:

```bash
ssh your-server "cd /var/www/dmp && pm2 restart dmp --update-env"
```

Or simply redeploy:

```bash
pnpm deploy:app  # Will recreate .env with latest local values
```

## GitLab CI/CD Pipeline

The pipeline is configured in `.gitlab-ci.yml` with a single production stage that runs on every push to `main`. It's a placeholder pipeline that doesn't perform any actions on the server.

**All deployment is done locally** using the commands below.

## Deployment

### Deploy Application

To deploy from your local machine:

```bash
pnpm deploy:app
```

This command:
1. Tests SSH connection
2. **Builds the Nuxt app locally with `PARTY_ROLE=listener` override** (for production listener mode)
3. Syncs `.output/` directory to the server
4. Syncs `public/` directory to the server
5. Syncs `ecosystem.config.cjs` and `package.json` to the server
6. **Auto-creates server `.env` file** with listener configuration:
   - Forces `PARTY_ROLE=listener` for production
   - Sets `MEDIASOUP_ANNOUNCED_IP` to your server's IP automatically
   - Copies all other env vars from your local `.env`
7. Installs production dependencies on server
8. Copies mediasoup worker binary (required for Party Mode)
9. Restarts PM2 on the server

**Important:** The build is done locally with `PARTY_ROLE=listener` so the production site runs in listener mode (read-only UI for remote listeners), while your local development environment remains as `host`.

### Deploy Nginx Configuration

To deploy or update the Nginx configuration:

```bash
pnpm deploy:nginx
```

This command:
1. Syncs `nginx-dmp.conf` to the server
2. Installs it to `/etc/nginx/sites-available/dmp`
3. Enables the site
4. Creates the cache directory
5. Tests and reloads Nginx

### Deploy Database

To restore the database from a local backup:

```bash
pnpm deploy:db
```

This command:
1. Finds the latest local dump file in `dump/`
2. Uploads it to the server
3. Drops and recreates the database
4. Restores the data using `psql`
5. Cleans up old dumps on the server

### Clear Nginx Cache

To clear the Nginx cache without redeploying:

```bash
pnpm deploy:uncache
```

This command:
1. Removes all cached files from `/var/cache/nginx/dmp/`
2. Reloads Nginx

### Backup Database

To create a local backup of the production database:

```bash
pnpm backup
```

This command:
1. Connects to the production database via SSH
2. Creates a compressed dump using `pg_dump`
3. Downloads it to `dump/` directory locally
4. Names it with timestamp: `dmp6_YYYY-MM-DD_HH-MM-SS.sql.gz`

### Restore Database Locally

To restore a backup to your local database:

```bash
pnpm restore [filename]
```

Examples:
```bash
# Restore latest backup
pnpm restore

# Restore specific backup
pnpm restore dmp6_2026-02-18_14-30-00.sql.gz
```

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
