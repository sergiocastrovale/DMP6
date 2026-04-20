# Handling artist and release cover images

## Goals

We should be able to specify whether we want to keep our artist and release cover images locally or in an S3 bucket.

We control this via the .env:

```bash
IMAGE_STORAGE=s3 # can be s3, local or both
```

This variable is read by both the `index` and `sync` scripts so they can act accordingly after downloading/extracting the images.

### Implementation Status: ✅ COMPLETE

**For S3**:
- ✅ Use the S3 credentials stored in .env and upload to S3
- ✅ Set the `Artist.imageUrl` or `LocalRelease.imageUrl` as the full URL to the image (for use in the web app)

**For local**:
- ✅ Set the `Artist.image` or `LocalRelease.image` as the path to the image

**For both**:
- ✅ Combine both strategies - saves locally AND uploads to S3

## S3 Setup Guide

### Step 1: Create an S3 Bucket

1. **Log in to AWS Console**: Go to [AWS S3 Console](https://s3.console.aws.amazon.com/)

2. **Create a new bucket**:
   - Click "Create bucket"
   - Choose a unique bucket name (e.g., `dmp-img`)
   - Select your preferred region (e.g., `us-east-1`)
   - **Block Public Access**: Uncheck "Block all public access" since we need images to be publicly accessible
   - Acknowledge the warning
   - Click "Create bucket"

3. **Configure bucket policy** for public read access:
   - Go to your bucket → Permissions → Bucket Policy
   - Add this policy (replace `YOUR-BUCKET-NAME`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

4. **Configure Object Ownership** (required for public access):
   - Go to your bucket → Permissions → Object Ownership
   - Click "Edit"
   - Select **"Bucket owner enforced"** (ACLs disabled - recommended)
   - Click "Save changes"
   - This makes the bucket policy control access instead of per-object ACLs

### Step 2: Create IAM User for Programmatic Access

1. **Go to IAM Console**: [AWS IAM Console](https://console.aws.amazon.com/iam/)

2. **Create a new user**:
   - Click "Users" → "Create user"
   - User name: `dmp-s3-uploader`
   - Check "Programmatic access"
   - Click "Next"

3. **Attach permissions**:
   - Click "Attach policies directly"
   - Search and select `AmazonS3FullAccess` (or create a custom policy with just `s3:PutObject` and `s3:PutObjectAcl` for better security)
   - Click "Next" → "Create user"

4. **Save credentials**:
   - **Access Key ID** - Save this
   - **Secret Access Key** - Save this (only shown once!)

### Step 3: Configure .env

Add these variables to your `web/.env` file:

```bash
# Image Storage Configuration
IMAGE_STORAGE=s3  # or "local" or "both"
BACKUP_STORAGE=s3  # or "local" or "both"

# S3 bucket names
S3_IMAGE_BUCKET=dmp-img
S3_BACKUPS_BUCKET=backups

# AWS credentials
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_HERE
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY_HERE
S3_ENDPOINT=  # Leave empty for AWS S3, or set for S3-compatible services
S3_PUBLIC_URL=https://dmp-img.s3.us-east-1.amazonaws.com
```

### Step 4: Test Configuration

After configuring, run:

```bash
./index "/path/to/music" --only="Test"
```

Images will be:
- Uploaded to S3 if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`
- Saved locally if `IMAGE_STORAGE=local` or `IMAGE_STORAGE=both`
- URLs stored in `Artist.imageUrl` and `LocalRelease.imageUrl` fields

### Using S3-Compatible Services

If using Backblaze B2, DigitalOcean Spaces, or MinIO:

```bash
S3_ENDPOINT=https://s3.us-west-000.backblazeb2.com  # Example for B2
S3_PUBLIC_URL=https://f000.backblazeb2.com/file/your-bucket-name
```

### Cost Estimates

**AWS S3 Pricing (us-east-1)**:
- Storage: $0.023/GB per month
- PUT requests: $0.005 per 1,000 requests
- GET requests: $0.0004 per 1,000 requests

For 2 million tracks with ~26 images:
- ~26 image files = ~10MB total
- Cost: < $1/year

### Security Best Practices

1. **Use custom IAM policy** instead of `AmazonS3FullAccess`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME/*",
        "arn:aws:s3:::YOUR-BUCKET-NAME"
      ]
    }
  ]
}
```

2. **Enable versioning** on your bucket for backup
3. **Set up lifecycle rules** to delete old versions if needed
4. **Use CloudFront** for better performance (optional)

## Image Deletion

Image cleanup is always synchronous — every deletion path removes the local file and the S3 object **before** deleting the DB row. There is no queue, no trigger, no background worker: if a row is gone, its images are gone too.

### Deletion paths

| Trigger | Handler |
|---|---|
| Full DB reset | `./nuke` — wipes all local + S3 images, then truncates tables |
| `./nuke --only="Artist"` | Removes that artist's images + cascaded orphan artist/release images |
| `./index` (folder removed from disk) | `detect_deleted_folders` calls `delete_release_images` / `delete_artist_images` before deleting empty releases and orphan artists |
| `./sync` (ghost artists) | `cleanup_ghost_artists` calls `delete_artist_images` before the DB delete |
| `./fix --orphans` | Deletes the artist's images before deleting the `Artist` row |
| `./fix --duplicates` | Deletes artist B's image before merging B into A |

### Shared helpers

Both helpers live in [`scripts/common/src/images.rs`](../scripts/common/src/images.rs):

- `delete_artist_images(pool, config, artist_ids)` — looks up `slug`, `image`, `imageUrl` and deletes `web/public/img/artists/{image}` + S3 key `artists/{slug}.jpg`
- `delete_release_images(pool, config, release_ids)` — looks up `image`, `imageUrl` and deletes `web/public/img/releases/{image}` + S3 key `releases/{id}.jpg`

Both respect `IMAGE_STORAGE` (local / s3 / both) and are safe to call with an empty slice.
