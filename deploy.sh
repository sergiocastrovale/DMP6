#!/usr/bin/env bash
set -euo pipefail

# Load .env from web/ directory
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$PROJECT_ROOT/web"

if [ -f "$WEB_DIR/.env" ]; then
  set -a
  source "$WEB_DIR/.env"
  set +a
fi

# NAS connection settings (reuses existing deploy env vars)
NAS_HOST="${SERVER_HOST:?SERVER_HOST not set in .env}"
NAS_USER="${SERVER_USER:?SERVER_USER not set in .env}"
NAS_DEPLOY_PATH="${DEPLOY_PATH:-/mnt/pool/appdata/dmp}"
SSH_KEY="${SSH_KEY_PATH:-}"

SSH_OPTS=""
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="-i $SSH_KEY"
fi

ssh_cmd() {
  ssh $SSH_OPTS "$NAS_USER@$NAS_HOST" "$@"
}

scp_cmd() {
  scp $SSH_OPTS "$@"
}

MODE="${1:-all}"

echo "=== DMP Docker Deploy ==="
echo "Target: $NAS_USER@$NAS_HOST:$NAS_DEPLOY_PATH"
echo ""

# Build web image
if [ "$MODE" = "all" ] || [ "$MODE" = "web" ] || [ "$MODE" = "build" ]; then
  echo "--- Building web image ---"
  docker build -t dmp-web:latest "$WEB_DIR"
  echo ""
fi

# Build scripts image
if [ "$MODE" = "all" ] || [ "$MODE" = "scripts" ] || [ "$MODE" = "build" ]; then
  echo "--- Building scripts image ---"
  docker build -t dmp-scripts:latest "$PROJECT_ROOT/scripts"
  echo ""
fi

# Save and transfer
if [ "$MODE" = "all" ] || [ "$MODE" = "web" ] || [ "$MODE" = "scripts" ] || [ "$MODE" = "push" ]; then
  IMAGES=""
  if [ "$MODE" = "web" ]; then
    IMAGES="dmp-web:latest"
  elif [ "$MODE" = "scripts" ]; then
    IMAGES="dmp-scripts:latest"
  else
    IMAGES="dmp-web:latest dmp-scripts:latest"
  fi

  echo "--- Saving images: $IMAGES ---"
  ARCHIVE="/tmp/dmp-images.tar.gz"
  docker save $IMAGES | gzip > "$ARCHIVE"
  SIZE=$(du -h "$ARCHIVE" | cut -f1)
  echo "Archive size: $SIZE"

  echo "--- Transferring to NAS ---"
  scp_cmd "$ARCHIVE" "$NAS_USER@$NAS_HOST:/tmp/dmp-images.tar.gz"

  echo "--- Loading images on NAS ---"
  ssh_cmd "docker load < /tmp/dmp-images.tar.gz && rm /tmp/dmp-images.tar.gz"
  rm "$ARCHIVE"
  echo ""
fi

# Deploy compose + .env
if [ "$MODE" = "all" ] || [ "$MODE" = "deploy" ]; then
  echo "--- Deploying compose configuration ---"
  ssh_cmd "mkdir -p $NAS_DEPLOY_PATH"
  scp_cmd "$PROJECT_ROOT/docker-compose.yml" "$NAS_USER@$NAS_HOST:$NAS_DEPLOY_PATH/"

  echo "--- Deploying NAS script wrappers ---"
  scp_cmd "$PROJECT_ROOT/scripts/_docker_run" "$PROJECT_ROOT/sync" "$PROJECT_ROOT/analysis" "$PROJECT_ROOT/nuke" "$PROJECT_ROOT/audit" "$PROJECT_ROOT/fix" "$PROJECT_ROOT/refresh" "$PROJECT_ROOT/playlists" "$NAS_USER@$NAS_HOST:$NAS_DEPLOY_PATH/"
  ssh_cmd "chmod +x $NAS_DEPLOY_PATH/sync $NAS_DEPLOY_PATH/analysis $NAS_DEPLOY_PATH/nuke $NAS_DEPLOY_PATH/audit $NAS_DEPLOY_PATH/fix $NAS_DEPLOY_PATH/refresh $NAS_DEPLOY_PATH/playlists"

  echo "--- Restarting containers ---"
  ssh_cmd "cd $NAS_DEPLOY_PATH && docker compose up -d"

  echo "--- Applying DB schema ---"
  ssh_cmd "cd $NAS_DEPLOY_PATH && sleep 3 && docker compose exec -T web prisma db push --schema=prisma/schema.prisma --accept-data-loss 2>&1 || true"
  echo ""
fi

echo "=== Done ==="
echo ""
echo "Usage:"
echo "  $0           # Build all, transfer, deploy"
echo "  $0 web       # Build + deploy web image only"
echo "  $0 scripts   # Build + deploy scripts image only"
echo "  $0 build     # Build both images locally (no transfer)"
echo "  $0 push      # Transfer pre-built images to NAS"
echo "  $0 deploy    # Deploy compose config + restart (no build)"
