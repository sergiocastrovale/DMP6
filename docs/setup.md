# DMP v6 Server Setup Guide

Complete guide for setting up a fresh Ubuntu server for DMP v6 with Party Mode support.

## Architecture Overview

DMP v6 uses a **local build + SSH upload** deployment strategy:

1. Build the Nuxt 4 app locally
2. Upload the `.output` bundle via SSH
3. PM2 manages the Node.js process
4. Nginx serves as reverse proxy with SSL
5. PostgreSQL stores all data
6. mediasoup handles WebRTC for Party Mode

## Quick Setup

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

Follow the detailed steps below for complete control.

---

## Manual Installation Steps

### Phase 1: System Dependencies

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

### Phase 3: Environment Configuration

Create `/var/www/dmp/.env`:

```bash
cat > /var/www/dmp/.env << 'EOF'
# Database
DATABASE_URL=postgresql://dmp6:qjEeKvG7a6bmLlF6BzeQGblh@localhost:5432/dmp6

# Image Storage (AWS S3)
IMAGE_STORAGE=s3
S3_BUCKET=dmp-img
S3_REGION=eu-north-1
S3_ACCESS_KEY_ID=AKIAVEFZNDOBHZKD4IU7
S3_SECRET_ACCESS_KEY=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
S3_PUBLIC_URL=https://dmp-img.s3.eu-north-1.amazonaws.com

# Party Mode (Listener Role)
PARTY_ENABLED=true
PARTY_ROLE=listener
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=YOUR_IP
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100
EOF
```

**Environment Variables Explained**:

- `DATABASE_URL`: PostgreSQL connection string
- `IMAGE_STORAGE=s3`: Use AWS S3 for artist/release images
- `PARTY_ENABLED=true`: Enable Party Mode feature
- `PARTY_ROLE=listener`: This server acts as the SFU/listener endpoint
- `MEDIASOUP_ANNOUNCED_IP`: Public IP for WebRTC connections
- `RTC_MIN_PORT` / `RTC_MAX_PORT`: UDP port range for WebRTC (must match firewall rules)

---

### Phase 4: SSL Certificate Setup

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

### Phase 5: Deployment from Local Machine

Now that the server is configured, deploy the application from your local machine.

#### 5.1 Deploy Nginx Configuration

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

#### 5.3 Deploy Database

**Option A**: Deploy from local backup

```bash
# Create a local backup first
pnpm backup

# Deploy to server
pnpm deploy:db
```

**Option B**: Initialize fresh database on server

```bash
# SSH to server
ssh root@YOUR_IP

# Navigate to deploy directory
cd /var/www/dmp

# Install dependencies (if not already done)
pnpm install

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# (Optional) Seed database
npx prisma db seed
```

---

## Verification & Testing

### Check Services

```bash
# On server, verify all services are running
systemctl status postgresql  # Should be active (running)
systemctl status nginx       # Should be active (running)
pm2 status                   # Should show 'dmp' online

# Check PM2 logs
pm2 logs dmp --lines 50

# Look for mediasoup worker startup
pm2 logs dmp | grep mediasoup
# Should see: [mediasoup] Worker started [pid:XXXXX, ports:10000-10100]
```

### Test Website

```bash
# Test HTTP redirect to HTTPS
curl -I http://discodomeuprimo.online
# Should return 301 redirect to https://

# Test HTTPS
curl -I https://discodomeuprimo.online
# Should return 200 OK

# Test from browser
open https://discodomeuprimo.online
```

### Test Party Mode

1. **On local machine** (host):
   - Set `.env`: `PARTY_ENABLED=true`, `PARTY_ROLE=host`, `PARTY_URL=wss://discodomeuprimo.online/_ws`
   - Start dev server: `pnpm dev`
   - Navigate to `/party`
   - Click "Start Session"
   - Copy the invite URL

2. **On server** (listener):
   - Open the invite URL in a browser
   - Should see the DMP interface in read-only mode
   - Audio should stream from host to listener
   - Metadata (track info, play/pause) should sync

### Check Firewall

```bash
ufw status verbose
```

Ensure ports 80, 443, and 10000-10100/udp are open.

---

## Database Management

### Backup Database

```bash
# From local machine
cd /home/kp/web/DMPv6/web
pnpm backup
```

Creates a compressed backup in `dump/YYYY-MM-DD-HH-MM-SS.sql.gz`.

### Restore Database

```bash
# From local machine (restores to local DB)
pnpm restore

# To restore on server
pnpm deploy:db
```

### Manual Database Operations

```bash
# SSH to server
ssh root@YOUR_IP

# Access PostgreSQL
sudo -u postgres psql

# Connect to dmp6 database
\c dmp6

# List tables
\dt

# Exit
\q
```

---

## Deployment Scripts

All deployment scripts are in `web/scripts/`:

- **`deploy.ts`**: Main deployment orchestrator
- **`backup.ts`**: Creates PostgreSQL dumps
- **`restore.ts`**: Restores from backups
- **`server-setup.sh`**: Automated server setup

### Available Commands

```bash
# Build and deploy app
pnpm deploy:app

# Deploy database from latest backup
pnpm deploy:db

# Deploy Nginx configuration
pnpm deploy:nginx

# Clear Nginx cache
pnpm deploy:uncache

# Create database backup
pnpm backup

# Restore from backup (local)
pnpm restore
```

---

## Configuration Files

### Local Files (in `web/`)

- **`.env`**: Local environment variables (host mode)
- **`ecosystem.config.cjs`**: PM2 process configuration
- **`nginx-dmp.conf`**: Nginx reverse proxy configuration
- **`server.env.example`**: Example server environment file

### Server Files (in `/var/www/dmp/`)

- **`.env`**: Server environment variables (listener mode)
- **`.output/`**: Built Nuxt application bundle
- **`public/`**: Static assets (images, etc.)
- **`dump/`**: Database backups
- **`ecosystem.config.cjs`**: PM2 configuration (uploaded during deploy)

---

## Troubleshooting

### PM2 Process Not Starting

```bash
# Check logs
pm2 logs dmp --lines 100

# Check for errors
pm2 describe dmp

# Restart process
pm2 restart dmp

# If stuck, delete and recreate
pm2 delete dmp
cd /var/www/dmp
pm2 start ecosystem.config.cjs
pm2 save
```

### Nginx 502 Bad Gateway

```bash
# Check if Node.js is running
pm2 status

# Check Nginx error logs
tail -f /var/log/nginx/error.log

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Database Connection Errors

```bash
# Verify PostgreSQL is running
systemctl status postgresql

# Test connection
PGPASSWORD=qjEeKvG7a6bmLlF6BzeQGblh psql -h localhost -U dmp6 -d dmp6 -c "SELECT 1;"

# Check .env file
cat /var/www/dmp/.env | grep DATABASE_URL
```

### WebRTC / Party Mode Not Working

```bash
# Check firewall
ufw status | grep 10000:10100

# Check mediasoup worker in logs
pm2 logs dmp | grep mediasoup

# Verify MEDIASOUP_ANNOUNCED_IP is correct
cat /var/www/dmp/.env | grep MEDIASOUP_ANNOUNCED_IP

# Test WebSocket connection
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://discodomeuprimo.online/_ws
```

### SSL Certificate Issues

```bash
# Check certificate expiry
certbot certificates

# Renew certificates manually
certbot renew

# Test renewal
certbot renew --dry-run
```

---

## Maintenance

### Update Application

```bash
# From local machine
cd /home/kp/web/DMPv6/web

# Pull latest changes
git pull

# Install dependencies
pnpm install

# Deploy
pnpm deploy:app
```

### Update Database Schema

```bash
# After Prisma schema changes
pnpm deploy:app  # Uploads new schema

# SSH to server
ssh root@YOUR_IP
cd /var/www/dmp

# Apply migrations
npx prisma db push

# Or use migrations
npx prisma migrate deploy
```

### Monitor Resources

```bash
# On server
htop                    # CPU/RAM usage
pm2 monit               # PM2 process monitor
df -h                   # Disk usage
free -h                 # Memory usage
```

### View Logs

```bash
# PM2 logs
pm2 logs dmp

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log

# PostgreSQL logs
tail -f /var/log/postgresql/postgresql-16-main.log
```

---

## Security Notes

1. **Database Password**: Change the default password in production
2. **SSH Keys**: Use key-based authentication, disable password login
3. **Firewall**: Only open necessary ports
4. **SSL**: Keep certificates up to date (auto-renewal is configured)
5. **Environment Variables**: Never commit `.env` files to git
6. **AWS Credentials**: Rotate S3 access keys periodically

---

## Key Changes from Previous Setup

### MySQL → PostgreSQL

- **Dump command**: `mysqldump` → `pg_dump`
- **Restore command**: `mysql` → `psql`
- **Password handling**: `-p$PASS` → `PGPASSWORD=$PASS`
- **Default port**: 3306 → 5432
- **Admin database**: `mysql` → `postgres`

### Nuxt 3 → Nuxt 4

- Updated build output structure
- New Nitro server engine
- WebSocket support via `defineWebSocketHandler`

### New Features

- **Party Mode**: WebRTC audio streaming via mediasoup
- **WebSocket Support**: Real-time signaling for Party Mode
- **S3 Image Storage**: Centralized image hosting

---

## Summary

You now have a fully configured DMP v6 server with:

✅ Node.js 20.x LTS  
✅ PostgreSQL 16  
✅ PM2 process manager  
✅ Nginx reverse proxy with SSL  
✅ Firewall configured  
✅ Party Mode enabled (listener role)  
✅ Automated deployment scripts  
✅ Database backup/restore system  

**Next Steps**:
1. Test the website: https://discodomeuprimo.online
2. Test Party Mode by starting a session from your local machine
3. Set up monitoring and alerts
4. Configure automated backups (cron job)

For issues or questions, check the Troubleshooting section or review PM2/Nginx logs.
