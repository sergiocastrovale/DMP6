#!/bin/bash
# DMP v6 Server Setup Script
# Run this on a fresh Ubuntu server as root
#
# Usage:
#   1. Set environment variables in your local .env file (see below)
#   2. Run: ssh $SERVER_USER@$SERVER_HOST 'bash -s' < web/scripts/server-setup.sh
#   OR
#   3. Copy to server and run manually:
#      scp web/scripts/server-setup.sh root@YOUR_SERVER_IP:/root/
#      ssh root@YOUR_SERVER_IP
#      chmod +x /root/server-setup.sh
#      DEPLOY_DOMAIN=your-domain.com DEPLOY_PATH=/var/www/dmp ./server-setup.sh
#
# Required environment variables (set in local .env with DEPLOY_ prefix):
#   DEPLOY_DOMAIN - Your domain name (e.g., discodomeuprimo.online)
#   DEPLOY_PATH - Server deployment path (e.g., /var/www/dmp)
#   DEPLOY_DB_NAME - Database name (e.g., dmp6)
#   DEPLOY_DB_USER - Database user (e.g., dmp6)
#   SERVER_HOST - Server IP address (for MEDIASOUP_ANNOUNCED_IP)
#
# Optional environment variables:
#   DEPLOY_DB_PASSWORD - Database password (if not set, generates a secure random one)

set -e

echo "=========================================="
echo "DMP v6 Server Setup"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration from environment variables
DOMAIN="${DEPLOY_DOMAIN}"
DEPLOY_PATH="${DEPLOY_PATH}"
DB_NAME="${DEPLOY_DB_NAME:-dmp6}"
DB_USER="${DEPLOY_DB_USER:-dmp6}"
SERVER_IP="${SERVER_HOST}"

# Validate required variables
if [ -z "$DOMAIN" ]; then
  echo -e "${RED}Error: DEPLOY_DOMAIN environment variable is required${NC}"
  echo "Example: DEPLOY_DOMAIN=discodomeuprimo.online"
  exit 1
fi

if [ -z "$DEPLOY_PATH" ]; then
  echo -e "${RED}Error: DEPLOY_PATH environment variable is required${NC}"
  echo "Example: DEPLOY_PATH=/var/www/dmp"
  exit 1
fi

if [ -z "$SERVER_IP" ]; then
  echo -e "${RED}Error: SERVER_HOST environment variable is required${NC}"
  echo "Example: SERVER_HOST=123.245.198.218"
  exit 1
fi

# Generate secure database password if not provided
if [ -z "$DEPLOY_DB_PASSWORD" ]; then
  echo -e "${YELLOW}Generating secure database password...${NC}"
  DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-24)
  echo -e "${GREEN}Generated password: ${DB_PASSWORD}${NC}"
  echo -e "${YELLOW}IMPORTANT: Save this password! Add to your local .env:${NC}"
  echo -e "${YELLOW}DEPLOY_DB_PASSWORD=${DB_PASSWORD}${NC}"
  echo ""
else
  DB_PASSWORD="$DEPLOY_DB_PASSWORD"
  echo -e "${GREEN}Using provided database password${NC}"
fi

echo ""
echo "Configuration:"
echo "  Domain: $DOMAIN"
echo "  Deploy Path: $DEPLOY_PATH"
echo "  Database: $DB_NAME"
echo "  DB User: $DB_USER"
echo "  Server IP: $SERVER_IP"
echo ""

echo -e "${GREEN}Step 1: System Update${NC}"
apt update && apt upgrade -y
apt install -y curl wget git build-essential python3 python3-pip ufw
echo ""

echo -e "${GREEN}Step 2: Install Node.js 20.x LTS${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm
echo "Node version: $(node --version)"
echo "pnpm version: $(pnpm --version)"
echo ""

echo -e "${GREEN}Step 3: Install PostgreSQL${NC}"
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

echo "Creating database and user..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" || echo "User may already exist"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" || echo "Database may already exist"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
echo ""

echo -e "${GREEN}Step 4: Install PM2${NC}"
npm install -g pm2
pm2 startup systemd
echo -e "${YELLOW}IMPORTANT: Run the command above if this is the first time setting up PM2${NC}"
echo ""

echo -e "${GREEN}Step 5: Install Nginx${NC}"
apt install -y nginx
systemctl start nginx
systemctl enable nginx
echo ""

echo -e "${GREEN}Step 6: Install Certbot${NC}"
apt install -y certbot python3-certbot-nginx
echo ""

echo -e "${GREEN}Step 7: Configure Firewall${NC}"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 10000:10100/udp
ufw --force enable
ufw status
echo ""

echo -e "${GREEN}Step 8: Create Deployment Directory${NC}"
mkdir -p $DEPLOY_PATH
mkdir -p $DEPLOY_PATH/.output
mkdir -p $DEPLOY_PATH/public
mkdir -p $DEPLOY_PATH/dump
chown -R root:root $DEPLOY_PATH
echo "Created $DEPLOY_PATH"
echo ""

echo -e "${GREEN}Step 9: Create Server .env File${NC}"

# Check if we have environment variables passed from local .env
if [ -n "$IMAGE_STORAGE" ] && [ -n "$S3_IMAGE_BUCKET" ]; then
  echo "Using configuration from local environment..."
  cat > $DEPLOY_PATH/.env << EOF
# Database
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}

# Image Storage
IMAGE_STORAGE=${IMAGE_STORAGE}
S3_IMAGE_BUCKET=${S3_IMAGE_BUCKET}
AWS_REGION=${AWS_REGION}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
S3_ENDPOINT=${S3_ENDPOINT}
S3_PUBLIC_URL=${S3_PUBLIC_URL}

# Party Mode (Listener)
PARTY_ENABLED=true
PARTY_ROLE=listener
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=${SERVER_IP}
RTC_MIN_PORT=${RTC_MIN_PORT:-10000}
RTC_MAX_PORT=${RTC_MAX_PORT:-10100}
EOF
else
  echo -e "${YELLOW}Warning: S3 configuration not provided. Creating minimal .env file.${NC}"
  echo -e "${YELLOW}You'll need to manually add IMAGE_STORAGE and S3 credentials.${NC}"
  cat > $DEPLOY_PATH/.env << EOF
# Database
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}

# Image Storage (CONFIGURE THIS)
IMAGE_STORAGE=s3
S3_IMAGE_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_ENDPOINT=
S3_PUBLIC_URL=

# Party Mode (Listener)
PARTY_ENABLED=true
PARTY_ROLE=listener
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=${SERVER_IP}
RTC_MIN_PORT=${RTC_MIN_PORT:-10000}
RTC_MAX_PORT=${RTC_MAX_PORT:-10100}
EOF
fi

echo "Created $DEPLOY_PATH/.env"
echo ""

echo -e "${GREEN}=========================================="
echo "Setup Complete!"
echo "==========================================${NC}"
echo ""
echo "Configuration Summary:"
echo "  Domain: $DOMAIN"
echo "  Deploy Path: $DEPLOY_PATH"
echo "  Database: $DB_NAME"
echo "  DB User: $DB_USER"
echo ""
echo -e "${YELLOW}IMPORTANT: Save your database password!${NC}"
echo "Database password: $DB_PASSWORD"
echo ""
echo "Next steps:"
echo "1. From your local machine, run: pnpm deploy:nginx"
echo "2. On this server, run: certbot --nginx -d $DOMAIN"
echo "3. From your local machine, run: pnpm deploy:app"
echo "4. From your local machine, run: pnpm deploy:db (or setup database manually)"
echo ""
echo -e "${YELLOW}Add to your local .env file:${NC}"
echo "DEPLOY_DB_PASSWORD=$DB_PASSWORD"
