# Stage 1: Build all Rust binaries
FROM rust:1-bookworm AS builder

WORKDIR /build

# Copy workspace manifest first (dependency layer caching)
COPY Cargo.toml Cargo.toml

# Copy all member Cargo.toml files
COPY dmp-common/Cargo.toml dmp-common/Cargo.toml
COPY dmp-index/Cargo.toml dmp-index/Cargo.toml
COPY dmp-sync/Cargo.toml dmp-sync/Cargo.toml
COPY dmp-fix/Cargo.toml dmp-fix/Cargo.toml
COPY analysis/Cargo.toml analysis/Cargo.toml
COPY clean/Cargo.toml clean/Cargo.toml
COPY nuke/Cargo.toml nuke/Cargo.toml
COPY audit/Cargo.toml audit/Cargo.toml
COPY genre-playlists/Cargo.toml genre-playlists/Cargo.toml
# Create dummy src files to pre-build dependencies
RUN mkdir -p dmp-common/src dmp-index/src dmp-sync/src dmp-fix/src analysis/src clean/src nuke/src audit/src genre-playlists/src \
    && echo 'pub mod config; pub mod db; pub mod slug; pub mod filters; pub mod artists; pub mod s3; pub mod progress; pub mod lock; pub mod checkpoint; pub mod totals; pub mod statistics; pub mod types;' > dmp-common/src/lib.rs \
    && for m in config db slug filters artists s3 progress lock checkpoint totals statistics types; do echo '' > dmp-common/src/$m.rs; done \
    && echo 'fn main(){}' > dmp-index/src/main.rs \
    && echo 'fn main(){}' > dmp-sync/src/main.rs \
    && echo 'fn main(){}' > dmp-fix/src/main.rs \
    && echo 'fn main(){}' > analysis/src/main.rs \
    && echo 'fn main(){}' > clean/src/main.rs \
    && echo 'fn main(){}' > nuke/src/main.rs \
    && echo 'fn main(){}' > audit/src/main.rs \
    && echo 'fn main(){}' > genre-playlists/src/main.rs

# Build dependencies only (cached unless Cargo.toml changes)
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY dmp-common/src dmp-common/src
COPY dmp-index/src dmp-index/src
COPY dmp-sync/src dmp-sync/src
COPY dmp-fix/src dmp-fix/src
COPY analysis/src analysis/src
COPY clean/src clean/src
COPY nuke/src nuke/src
COPY audit/src audit/src
COPY genre-playlists/src genre-playlists/src

# Touch source files to invalidate the dummy build
RUN find . -name '*.rs' -exec touch {} +

# Build all binaries
RUN cargo build --release --workspace

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim

# ca-certificates for HTTPS (MusicBrainz API, S3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binaries from builder
COPY --from=builder /build/target/release/dmp-index /usr/local/bin/
COPY --from=builder /build/target/release/dmp-sync /usr/local/bin/
COPY --from=builder /build/target/release/analysis /usr/local/bin/dmp-analysis
COPY --from=builder /build/target/release/dmp-clean /usr/local/bin/
COPY --from=builder /build/target/release/dmp-nuke /usr/local/bin/
COPY --from=builder /build/target/release/dmp-audit /usr/local/bin/
COPY --from=builder /build/target/release/dmp-fix /usr/local/bin/
COPY --from=builder /build/target/release/dmp-genre-playlists /usr/local/bin/

# Genre playlist groupings
COPY genre-playlists/genre-groups.json /app/genre-groups.json

# No default CMD — run specific binaries as needed:
#   docker run --rm dmp-scripts dmp-index [args]
#   docker run --rm dmp-scripts dmp-sync [args]
