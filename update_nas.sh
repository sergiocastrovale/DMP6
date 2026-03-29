docker build --no-cache -t dmp-web:latest web && web/scripts/deploy-docker.sh push && ssh nas "cd /mnt/SSD/web/dmp && docker compose up -d"
