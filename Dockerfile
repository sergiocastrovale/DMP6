# =============================================================================
# Stage 1: Build Rust binaries
# =============================================================================
FROM rust:1-bookworm AS scripts-builder

WORKDIR /build

# Copy workspace manifest + lock first (dependency layer caching)
COPY scripts/Cargo.toml Cargo.toml
COPY scripts/Cargo.lock Cargo.lock

# Copy all member Cargo.toml files
COPY scripts/common/Cargo.toml common/Cargo.toml
COPY scripts/index/Cargo.toml index/Cargo.toml
COPY scripts/sync/Cargo.toml sync/Cargo.toml
COPY scripts/fix/Cargo.toml fix/Cargo.toml
COPY scripts/analysis/Cargo.toml analysis/Cargo.toml
COPY scripts/nuke/Cargo.toml nuke/Cargo.toml
COPY scripts/audit/Cargo.toml audit/Cargo.toml
COPY scripts/playlists/Cargo.toml playlists/Cargo.toml
COPY scripts/delete/Cargo.toml delete/Cargo.toml
COPY scripts/mosaic/Cargo.toml mosaic/Cargo.toml
COPY scripts/dissect/Cargo.toml dissect/Cargo.toml
COPY scripts/problems/Cargo.toml problems/Cargo.toml
COPY scripts/extract-meta-images/Cargo.toml extract-meta-images/Cargo.toml
COPY scripts/artist-photos/Cargo.toml artist-photos/Cargo.toml

# Create dummy src files to pre-build dependencies
RUN mkdir -p common/src index/src sync/src fix/src analysis/src nuke/src audit/src playlists/src delete/src mosaic/src dissect/src problems/src extract-meta-images/src artist-photos/src \
    && echo 'pub mod config; pub mod db; pub mod slug; pub mod filters; pub mod artists; pub mod s3; pub mod progress; pub mod lock; pub mod checkpoint; pub mod totals; pub mod statistics; pub mod types; pub mod images;' > common/src/lib.rs \
    && for m in config db slug filters artists s3 progress lock checkpoint totals statistics types images; do echo '' > common/src/$m.rs; done \
    && echo 'fn main(){}' > index/src/main.rs \
    && echo 'fn main(){}' > sync/src/main.rs \
    && echo 'fn main(){}' > fix/src/main.rs \
    && echo 'fn main(){}' > analysis/src/main.rs \
    && echo 'fn main(){}' > nuke/src/main.rs \
    && echo 'fn main(){}' > audit/src/main.rs \
    && echo 'fn main(){}' > playlists/src/main.rs \
    && echo 'fn main(){}' > delete/src/main.rs \
    && echo 'fn main(){}' > mosaic/src/main.rs \
    && echo 'fn main(){}' > dissect/src/main.rs \
    && echo 'fn main(){}' > problems/src/main.rs \
    && echo 'fn main(){}' > extract-meta-images/src/main.rs \
    && echo 'fn main(){}' > artist-photos/src/main.rs

# Build dependencies only (cached unless Cargo.toml/Cargo.lock changes)
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY scripts/common/src common/src
COPY scripts/index/src index/src
COPY scripts/sync/src sync/src
COPY scripts/fix/src fix/src
COPY scripts/analysis/src analysis/src
COPY scripts/nuke/src nuke/src
COPY scripts/audit/src audit/src
COPY scripts/playlists/src playlists/src
COPY scripts/delete/src delete/src
COPY scripts/mosaic/src mosaic/src
COPY scripts/dissect/src dissect/src
COPY scripts/problems/src problems/src
COPY scripts/extract-meta-images/src extract-meta-images/src
COPY scripts/artist-photos/src artist-photos/src

# Touch source files to invalidate the dummy build
RUN find . -name '*.rs' -exec touch {} +

# Build all binaries. `problems` is excluded here and built separately below: it calls
# `audio::read_tags_guarded` (used by both --audit scanning and --fix:* tag writes), whose
# `catch_unwind` only actually catches a corrupt file's tag-parser panic under panic="unwind" - and
# [profile.release] sets panic="abort". See [profile.scan] in scripts/Cargo.toml.
RUN cargo build --release --workspace --exclude problems
RUN cargo build --profile scan -p problems

# =============================================================================
# Stage 2: Build Nuxt app
# =============================================================================
FROM node:20-bookworm AS web-builder

WORKDIR /build

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy dependency files first (Docker layer caching)
COPY web/package.json web/pnpm-lock.yaml ./
COPY web/prisma/schema.prisma prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate

# Copy source files
COPY web/ .

# Build Nuxt app
RUN pnpm build

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

# Copy built Nuxt output
COPY --from=web-builder /build/.output .output/
COPY --from=web-builder /build/prisma/schema.prisma prisma/schema.prisma
COPY --from=web-builder /build/prisma/migrations prisma/migrations/

# Prisma CLI for migrate deploy on deploy (pinned to match project version)
RUN npm install -g prisma@6

# tmux for persistent terminal sessions + ca-certificates for HTTPS (MusicBrainz, S3)
# ffmpeg to normalize Soulseek downloads to MP3-320 (see docs/feature_monitoring.md)
RUN apt-get update && apt-get install -y --no-install-recommends tmux ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*

# Rust script binaries
COPY --from=scripts-builder /build/target/release/index /usr/local/bin/
COPY --from=scripts-builder /build/target/release/sync /usr/local/bin/
COPY --from=scripts-builder /build/target/release/audit /usr/local/bin/
COPY --from=scripts-builder /build/target/release/fix /usr/local/bin/
COPY --from=scripts-builder /build/target/release/analysis /usr/local/bin/
COPY --from=scripts-builder /build/target/release/nuke /usr/local/bin/
COPY --from=scripts-builder /build/target/release/playlists /usr/local/bin/
COPY --from=scripts-builder /build/target/release/delete /usr/local/bin/
COPY --from=scripts-builder /build/target/release/mosaic /usr/local/bin/
COPY --from=scripts-builder /build/target/release/dissect /usr/local/bin/
COPY --from=scripts-builder /build/target/release/extract-meta-images /usr/local/bin/
COPY --from=scripts-builder /build/target/release/artist-photos /usr/local/bin/
# Note target/scan/, not target/release/ - `problems` uses the scan profile.
COPY --from=scripts-builder /build/target/scan/problems /usr/local/bin/

# Genre playlist config
COPY scripts/playlists/genre-groups.json /app/genre-groups.json

# refresh = index + sync (shell wrapper with artist ID piping)
COPY refresh /usr/local/bin/refresh
RUN chmod +x /usr/local/bin/refresh

# Create mount point directories
RUN mkdir -p /app/data/img/artists /app/data/img/releases /app/data/img/labs /app/data/dump

# Run as non-root user (added to root group for music dir write access)
RUN useradd -m -o -u 1000 -G root dmp && chown -R dmp:dmp /app /usr/local/lib/node_modules/prisma
USER dmp

ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV PORT=3000
ENV PROJECT_ROOT=/app
ENV SCRIPTS_DIR=/usr/local/bin

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
