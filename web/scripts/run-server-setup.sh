#!/bin/bash
# Helper script to run server-setup.sh with environment variables from .env
# Usage: ./scripts/run-server-setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env file
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "Error: .env file not found at $PROJECT_ROOT/.env"
  exit 1
fi

# Export variables from .env
set -a
source "$PROJECT_ROOT/.env"
set +a

# Validate required variables
if [ -z "$SERVER_HOST" ]; then
  echo "Error: SERVER_HOST not set in .env"
  exit 1
fi

if [ -z "$SERVER_USER" ]; then
  echo "Error: SERVER_USER not set in .env"
  exit 1
fi

if [ -z "$DEPLOY_DOMAIN" ]; then
  echo "Error: DEPLOY_DOMAIN not set in .env"
  exit 1
fi

echo "=========================================="
echo "Running server setup with configuration:"
echo "  Server: $SERVER_USER@$SERVER_HOST"
echo "  Domain: $DEPLOY_DOMAIN"
echo "  Deploy Path: $DEPLOY_PATH"
echo "  Database: $DEPLOY_DB_NAME"
echo "=========================================="
echo ""

# Run server-setup.sh on remote server with environment variables
ssh "$SERVER_USER@$SERVER_HOST" "bash -s" < "$SCRIPT_DIR/server-setup.sh" <<EOF
export DEPLOY_DOMAIN="$DEPLOY_DOMAIN"
export DEPLOY_PATH="$DEPLOY_PATH"
export DEPLOY_DB_NAME="$DEPLOY_DB_NAME"
export DEPLOY_DB_USER="$DEPLOY_DB_USER"
export DEPLOY_DB_PASSWORD="$DEPLOY_DB_PASSWORD"
export SERVER_HOST="$SERVER_HOST"
export IMAGE_STORAGE="$IMAGE_STORAGE"
export S3_BUCKET="$S3_BUCKET"
export S3_REGION="$S3_REGION"
export S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export S3_ENDPOINT="$S3_ENDPOINT"
export S3_PUBLIC_URL="$S3_PUBLIC_URL"
export RTC_MIN_PORT="$RTC_MIN_PORT"
export RTC_MAX_PORT="$RTC_MAX_PORT"
EOF

echo ""
echo "=========================================="
echo "Server setup complete!"
echo "=========================================="
