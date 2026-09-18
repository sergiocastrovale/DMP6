# Handling artist and release cover images

## Goals

Choose local disk or S3 for artist/release cover storage, via `.env`:

```bash
IMAGE_STORAGE=s3 # s3, local, or both
```

Read by both `index` and `sync` after downloading/extracting images.

- **s3** — uploads with `.env` credentials, stores the full URL in `Artist.imageUrl`/`LocalRelease.imageUrl`.
- **local** — stores the filename in `Artist.image`/`LocalRelease.image`, served from `web/public/img/`.
- **both** — saves locally *and* uploads.

Web app always resolves images via `useImageUrl()`, which picks between the two.

## S3 Setup Guide

### 1. Create an S3 bucket
- [AWS S3 Console](https://s3.console.aws.amazon.com/) → Create bucket, unique name (e.g. `dmp-img`), preferred region (e.g. `us-east-1`).
- **Block Public Access**: uncheck "Block all public access" (images need to be public), acknowledge, create.
- **Bucket Policy** (Permissions → Bucket Policy), public read:
```json
{
  "Version": "2012-10-17",
  "Statement": [{"Sid": "PublicReadGetObject", "Effect": "Allow", "Principal": "*",
    "Action": "s3:GetObject", "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"}]
}
```
- **Object Ownership** (Permissions → Object Ownership → Edit): select "Bucket owner enforced" (ACLs disabled) — policy controls access instead of per-object ACLs.

### 2. Create IAM user for programmatic access
[AWS IAM Console](https://console.aws.amazon.com/iam/) → Users → Create user `dmp-s3-uploader`, check "Programmatic access" → attach `AmazonS3FullAccess` (or the custom policy below) → save the **Access Key ID** and **Secret Access Key** (shown once).

### 3. Configure `web/.env`

```bash
IMAGE_STORAGE=s3  # or "local" or "both"
STORAGE_IMAGE_BUCKET=dmp-img
STORAGE_BACKUPS_BUCKET=backups
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_HERE
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY_HERE
STORAGE_ENDPOINT=  # empty for AWS S3, set for S3-compatible services
STORAGE_PUBLIC_URL=https://dmp-img.s3.us-east-1.amazonaws.com
```

### 4. Test

```bash
./index --only "Test" --exact
```

Images upload to S3 (`s3`/`both`), save locally (`local`/`both`), URLs stored in `Artist.imageUrl`/`LocalRelease.imageUrl`.

### S3-compatible services (Backblaze B2, DigitalOcean Spaces, MinIO)

```bash
STORAGE_ENDPOINT=https://s3.us-west-000.backblazeb2.com  # example for B2
STORAGE_PUBLIC_URL=https://f000.backblazeb2.com/file/your-bucket-name
```

### Cost

AWS S3 us-east-1: storage $0.023/GB/mo, PUT $0.005/1k, GET $0.0004/1k. For 2M tracks with ~26 images (~10MB total): <$1/year.

### Security

Custom IAM policy instead of `AmazonS3FullAccess`:
```json
{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow",
    "Action": ["s3:PutObject", "s3:PutObjectAcl", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::YOUR-BUCKET-NAME/*", "arn:aws:s3:::YOUR-BUCKET-NAME"]}]
}
```
Also: enable versioning for backup, lifecycle rules to prune old versions, CloudFront optional for performance.

`common::images::download_artist_image` is called from both `./sync` (per artist, normal run) and `./add` (once, right after creating the artist row) — same function, same Wikidata/Wikipedia/Fanart source order, non-fatal on failure either way.

## Image Deletion

Always synchronous — every deletion path removes the local file + S3 object **before** deleting the DB row. No queue, no trigger, no background worker: row gone → images gone too.

### Deletion paths

| Trigger | Handler |
|---|---|
| Full DB reset | `./nuke` — wipes all local+S3 images, then truncates tables |
| `./nuke --only="Artist"` | Removes that artist's images + cascaded orphan artist/release images |
| `./index` (folder removed from disk) | `detect_deleted_folders` calls `delete_release_images`/`delete_artist_images` before deleting empty releases and orphan artists |
| `./sync` (ghost artists) | `cleanup_ghost_artists` calls `delete_artist_images` before the DB delete |
| `./fix --orphans` | Deletes the artist's images before deleting the `Artist` row |
| `./fix --duplicates` | Deletes artist B's image before merging B into A |

### Shared helpers

Both in `scripts/common/src/images.rs`:
- `delete_artist_images(pool, config, artist_ids)` — looks up `slug`/`image`/`imageUrl`, deletes `web/public/img/artists/{image}` + S3 key `artists/{slug}.jpg`.
- `delete_release_images(pool, config, release_ids)` — looks up `image`/`imageUrl`, deletes `web/public/img/releases/{image}` + S3 key `releases/{id}.jpg`.

Both respect `IMAGE_STORAGE` (local/s3/both), safe to call with an empty slice.
