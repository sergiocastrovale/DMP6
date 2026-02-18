# DMP v6 Server Setup - Quick Start Guide

Follow these commands in order to complete your server setup.

## Prerequisites

- Ensure you can SSH to your server: `ssh root@YOUR_IP`
- If not, configure SSH keys or use password authentication

---

## Step 1: Setup Server (5-10 minutes)

Copy and run the automated setup script:

```bash
# From your local machine
cd /home/kp/web/DMPv6/web

# Copy setup script to server
scp scripts/server-setup.sh root@YOUR_IP:/root/

# SSH to server
ssh root@YOUR_IP

# Run setup script
chmod +x /root/server-setup.sh
./server-setup.sh

# IMPORTANT: If PM2 outputs a startup command, run it now
# It will look something like:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root
```

**What this does:**
- Installs Node.js 20.x, pnpm, PostgreSQL, PM2, Nginx, Certbot
- Configures firewall (SSH, HTTP, HTTPS, WebRTC ports)
- Creates `/var/www/dmp` directory structure
- Creates `.env` file with database credentials and Party Mode config

---

## Step 2: Configure SSL (2 minutes)

While still on the server:

```bash
# Replace your-email@example.com with your actual email
certbot --nginx -d discodomeuprimo.online --non-interactive --agree-tos --email your-email@example.com

# Test auto-renewal
certbot renew --dry-run

# Exit server
exit
```

---

## Step 3: Deploy Nginx Config (1 minute)

Back on your local machine:

```bash
cd /home/kp/web/DMPv6/web

# Deploy Nginx configuration
pnpm deploy:nginx
```

**What this does:**
- Uploads `nginx-dmp.conf` to server
- Enables the site
- Tests Nginx configuration
- Reloads Nginx

---

## Step 4: Build and Deploy App (3-5 minutes)

```bash
# Still in /home/kp/web/DMPv6/web

# Build and deploy the application
pnpm deploy:app
```

**What this does:**
- Builds the Nuxt 4 app locally
- Uploads `.output/` bundle to server
- Uploads `public/` directory (static assets)
- Uploads `ecosystem.config.cjs` (PM2 config)
- Installs dependencies on server
- Starts PM2 process

---

## Step 5: Setup Database (2-5 minutes)

Choose one option:

### Option A: Deploy from Local Backup (if you have data)

```bash
# Create a backup of your local database
pnpm backup

# Deploy to server
pnpm deploy:db
```

### Option B: Initialize Fresh Database (if starting fresh)

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

# (Optional) Seed database if you have a seed script
# npx prisma db seed

# Exit server
exit
```

---

## Step 6: Verify Installation (2 minutes)

```bash
# Check services on server
ssh root@YOUR_IP 'systemctl status postgresql && systemctl status nginx && pm2 status'

# Check PM2 logs for any errors
ssh root@YOUR_IP 'pm2 logs dmp --lines 50'

# Look for mediasoup worker startup
ssh root@YOUR_IP 'pm2 logs dmp | grep mediasoup'
# Should see: [mediasoup] Worker started [pid:XXXXX, ports:10000-10100]

# Test website
curl -I https://discodomeuprimo.online
# Should return: HTTP/2 200

# Open in browser
open https://discodomeuprimo.online
```

---

## Step 7: Test Party Mode (5 minutes)

### 7.1 Configure Local Environment (Host)

Edit `/home/kp/web/DMPv6/web/.env`:

```bash
# Add or update these lines:
PARTY_ENABLED=true
PARTY_ROLE=host
PARTY_URL=wss://discodomeuprimo.online/_ws
```

### 7.2 Start Local Dev Server

```bash
cd /home/kp/web/DMPv6/web
pnpm dev
```

### 7.3 Start Party Session

1. Open `http://localhost:3000/party` in your browser
2. Click "Start Session"
3. Copy the invite URL (e.g., `https://discodomeuprimo.online?session=xxx`)

### 7.4 Test Listener

1. Open the invite URL in a different browser or device
2. You should see:
   - DMP interface in read-only mode
   - No playlist/favorite buttons
   - Only play/pause and volume controls
3. Play a song on your local machine (host)
4. Verify:
   - Audio streams to the listener
   - Track info syncs (title, artist, cover)
   - Play/pause syncs
   - Progress bar syncs

---

## 🎉 Success!

If all steps completed successfully, you now have:

✅ DMP v6 running at https://discodomeuprimo.online  
✅ PostgreSQL database configured  
✅ PM2 managing the Node.js process  
✅ Nginx reverse proxy with SSL  
✅ Party Mode enabled (WebRTC streaming)  
✅ Firewall configured  
✅ Automated deployment scripts ready  

---

### Useful Commands

```bash
# Deployment
pnpm deploy:app      # Deploy application
pnpm deploy:db       # Deploy database
pnpm deploy:nginx    # Deploy Nginx config
pnpm backup          # Backup database
pnpm restore         # Restore database

# Server Management
ssh root@YOUR_IP                       # Connect to server
pm2 status                             # Check processes
pm2 logs dmp                           # View logs
pm2 restart dmp                        # Restart app
systemctl restart nginx                # Restart Nginx
systemctl restart postgresql           # Restart PostgreSQL
```
