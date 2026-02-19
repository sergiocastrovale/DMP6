# Setup: live

## First setup

### Option 1: Automated Setup Script

```bash
# From your local machine
cd /home/kp/web/DMPv6/web

# Copy setup script to server
scp scripts/server-setup.sh root@YOUR_IP:/root/

# SSH to server and run
ssh root@YOUR_IP
chmod +x /root/server-setup.sh
./server-setup.sh
```

The script installs all dependencies, creates directories, and configures the environment.

### Option 2: Manual Installation

Phase 1: System Dependencies

#### 1.1 System Update & Build Tools

```bash
apt update && apt upgrade -y
apt install -y curl wget git build-essential python3 python3-pip ufw
```

**Why**: Build tools are required for native Node.js modules (especially mediasoup).

#### 1.2 Node.js 20.x LTS & pnpm

```bash
# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install pnpm globally
npm install -g pnpm

# Verify installation
node --version  # Should show v20.x.x
pnpm --version
```

#### 1.3 PostgreSQL 16

```bash
# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Start and enable service
systemctl start postgresql
systemctl enable postgresql

# Create database and user
sudo -u postgres psql -c "CREATE USER dmp6 WITH PASSWORD 'qjEeKvG7a6bmLlF6BzeQGblh';"
sudo -u postgres psql -c "CREATE DATABASE dmp6 OWNER dmp6;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE dmp6 TO dmp6;"

# Verify
sudo -u postgres psql -l  # List databases
```

**Database Password**: `qjEeKvG7a6bmLlF6BzeQGblh` (keep secure!)

#### 1.4 PM2 Process Manager

```bash
# Install PM2 globally
npm install -g pm2

# Configure PM2 to start on boot
pm2 startup systemd
# IMPORTANT: Run the command it outputs (e.g., sudo env PATH=...)

# Save PM2 process list
pm2 save
```

#### 1.5 Nginx Reverse Proxy

```bash
# Install Nginx
apt install -y nginx

# Start and enable service
systemctl start nginx
systemctl enable nginx

# Verify
systemctl status nginx
curl http://localhost  # Should show Nginx welcome page
```

#### 1.6 Certbot (Let's Encrypt SSL)

```bash
# Install Certbot with Nginx plugin
apt install -y certbot python3-certbot-nginx

# Verify
certbot --version
```

#### 1.7 Firewall Configuration

```bash
# Allow SSH (don't lock yourself out!)
ufw allow 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow WebRTC ports for Party Mode (mediasoup)
ufw allow 10000:10100/udp

# Enable firewall
ufw --force enable

# Verify configuration
ufw status verbose
```

**Expected output**:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
10000:10100/udp           ALLOW       Anywhere
```

---

### Phase 2: Server Directory Setup

```bash
# Create deployment directory structure
mkdir -p /var/www/dmp
mkdir -p /var/www/dmp/.output
mkdir -p /var/www/dmp/public
mkdir -p /var/www/dmp/dump

# Set ownership
chown -R root:root /var/www/dmp

# Verify
ls -la /var/www/dmp
```
---

### Phase 3: SSL Certificate Setup

```bash
# Obtain SSL certificate for your domain
certbot --nginx -d discodomeuprimo.online --non-interactive --agree-tos --email your-email@example.com

# Test auto-renewal
certbot renew --dry-run
```

**Note**: Replace `your-email@example.com` with your actual email address.

Certbot will:
1. Verify domain ownership
2. Generate SSL certificates
3. Automatically configure Nginx to use them
4. Set up auto-renewal via systemd timer
---

### Phase 4: Deployment from Local Machine

Now that the server is configured, deploy the application from your local machine.

#### Deploy Nginx Configuration

```bash
cd /home/kp/web/DMPv6/web
pnpm deploy:nginx
```

This uploads `nginx-dmp.conf` to `/etc/nginx/sites-available/dmp` and enables it.

**What it does**:
- Configures reverse proxy to Node.js (port 3000)
- Sets up WebSocket support for Party Mode (`/_ws`)
- Configures SSL certificates
- Enables caching for static assets
- Sets security headers

#### 5.2 Build and Deploy Application

```bash
pnpm deploy:app
```

**What it does**:
1. Builds the Nuxt 4 app locally (`pnpm build`)
2. Uploads `.output/` bundle to server via rsync
3. Uploads `public/` directory (static assets)
4. Uploads `ecosystem.config.cjs` (PM2 configuration)
5. Restarts PM2 process

The server's `.env` file at `/var/www/dmp/.env` is automatically created. See `.env.example` for the overall structure.

**Key Points:**
- `PARTY_ROLE` is **always set to `listener`** on the server (regardless of your local setting)
- `MEDIASOUP_ANNOUNCED_IP` is **automatically set** to your `SERVER_HOST` value
- All other variables are copied from your local `.env`

#### 5.3 Deploy Database

```bash
# Create a local backup first
pnpm backup

# Deploy to server
pnpm deploy:db
```

## Deployment

### Deploy Application

We use a **local build + SSH upload** deployment strategy:

1. Build the Nuxt 4 app locally
2. Upload the `.output` bundle via SSH
3. PM2 manages the Node.js process
4. Nginx serves as reverse proxy with SSL
5. PostgreSQL stores all data
6. mediasoup handles WebRTC for Party Mode

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

In a normal situation we only need to run this once, when deploying to the live server the first time.

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

If for some reason the script fails, you can deploy manually:

```bash
# Build locally
pnpm install --frozen-lockfile && pnpm prisma generate && NODE_OPTIONS='--max-old-space-size=8192' nuxt build

# Deploy to server
rsync -avz --delete .output/ YOUR_USER@HOST_IP:/var/www/dmp/.output/ && ssh YOUR_USER@HOST_IP "cd /var/www/dmp && pm2 restart dmp"
```
