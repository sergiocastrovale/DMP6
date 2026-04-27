# Environment Variables

All variables live in `web/.env`. Copy `web/.env.example` as a starting point.

Some variables (downloads, storage, Fanart.tv) can also be set via the Settings DB table — DB values override env vars.

---

## Auth

### `ADMIN_USER`

Username for web UI login.

### `ADMIN_PASSWORD`

Password for web UI login.

## Database

### `DATABASE_URL`

PostgreSQL connection string. Include `connection_limit` and `pool_timeout` query params for Prisma.

Format: `postgresql://user:password@host:5432/dbname?connection_limit=20&pool_timeout=10`

### `REDIS_URL`

Optional. Enables server-side response caching. Leave empty to disable — the app falls through to DB silently.

Automatically configured by `docker-compose.yml` in production.

## Paths

### `MUSIC_DIR`

Absolute path to music library root. Must be mounted locally — WSL2 can't use UNC paths directly.

To mount NAS share in WSL2:

```bash
sudo mount -t cifs //192.168.1.241/music /mnt/dmp/music -o username=Kp,uid=$(id -u),gid=$(id -g)
```

### `PROJECT_ROOT`

Absolute path to the DMP project folder. Used by Rust scripts to locate config and image directories.

## Images

### `IMAGE_STORAGE`

Where images are stored. Values: `local`, `s3`, or `both`.

- `local` — served from `IMAGE_DIR` via middleware
- `s3` — served directly from S3 via `S3_PUBLIC_URL`
- `both` — local preferred, S3 as fallback

### `IMAGE_DIR`

Local directory for image files. Defaults to `./public/img`. Contains `artists/` and `releases/` subdirectories.

Not usually set explicitly — the default works for both dev and Docker.

### `NAS_URL`

Optional. For local dev only. When set, the server proxies images and audio to the NAS when local files are missing.

Set to the NAS web app URL (e.g. `http://192.168.1.241:3000`). Affects `/img/artists/*`, `/img/releases/*`, and `/api/audio/*`. Has no effect in production where files exist on disk.

## S3

### `S3_IMAGE_BUCKET`

S3 bucket name for artist/release images.

### `S3_BACKUPS_BUCKET`

S3 bucket name for database backups. Defaults to `backups`.

### `BACKUP_STORAGE`

Where backups are stored. Values: `local` or `s3`.

### `AWS_REGION`

AWS region for S3 buckets.

### `AWS_ACCESS_KEY_ID`

AWS access key.

### `AWS_SECRET_ACCESS_KEY`

AWS secret key.

### `S3_ENDPOINT`

Custom S3 endpoint for S3-compatible services (Backblaze, MinIO). Leave empty for AWS S3.

### `S3_PUBLIC_URL`

Public base URL for accessing S3 images. Used by the frontend to build image URLs in S3 mode.

Format: `https://bucket-name.s3.region.amazonaws.com`

## External APIs

### `FANART_API_KEY`

API key for Fanart.tv. Used to fetch artist images during sync.

## Deployment

### `SERVER_HOST`

NAS IP or hostname for deployment.

### `SERVER_USER`

SSH user on the NAS.

### `DEPLOY_PATH`

Absolute path on the NAS where the app is deployed.

### `SSH_KEY_PATH`

Path to SSH private key for NAS access.

## Downloads

Download settings can also be configured via the Settings DB table (DB values take priority).

### `DOWNLOADS_PATH`

Where downloaded files are written.

- Local dev: absolute path on your machine (e.g. `/home/you/Downloads/dmp`)
- Docker: set `DOWNLOADS_DIR` instead — `docker-compose.yml` mounts it and hard-codes `DOWNLOADS_PATH=/downloads`

### `DOWNLOADS_DIR`

Host-side directory mounted into Docker containers at `/downloads`. Only used by `docker-compose.yml`.

### `DOWNLOAD_DIR_TEMPLATE`

Folder structure template for downloads. Placeholders: `{artist}`, `{album}`, `{year}`. Slashes create nested folders. If `{year}` is unknown, surrounding separators collapse.

Default: `'{artist}/{year} - {album}'`

### `DOWNLOAD_FORMATS`

Comma-separated list of accepted audio formats (e.g. `flac,mp3`).

### `DOWNLOAD_MIN_BITRATE`

Minimum bitrate in kbps for download quality filtering.

### `SLSKD_URL`

URL of the slskd (Soulseek) instance.

### `SLSKD_API_KEY`

API key for slskd authentication.

### `DEEZER_ARL`

ARL cookie from a logged-in Deezer session. Get it from browser devtools: Application > Cookies > `arl` on deezer.com. Free account works.
