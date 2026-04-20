# Stage 1: Build all Rust binaries
FROM rust:1-bookworm AS builder

WORKDIR /build

# Copy workspace manifest first (dependency layer caching)
COPY Cargo.toml Cargo.toml

# Copy all member Cargo.toml files
COPY common/Cargo.toml common/Cargo.toml
COPY index/Cargo.toml index/Cargo.toml
COPY sync/Cargo.toml sync/Cargo.toml
COPY fix/Cargo.toml fix/Cargo.toml
COPY analysis/Cargo.toml analysis/Cargo.toml
COPY nuke/Cargo.toml nuke/Cargo.toml
COPY audit/Cargo.toml audit/Cargo.toml
COPY playlists/Cargo.toml playlists/Cargo.toml
# Create dummy src files to pre-build dependencies
RUN mkdir -p common/src index/src sync/src fix/src analysis/src nuke/src audit/src playlists/src \
    && echo 'pub mod config; pub mod db; pub mod slug; pub mod filters; pub mod artists; pub mod s3; pub mod progress; pub mod lock; pub mod checkpoint; pub mod totals; pub mod statistics; pub mod types; pub mod images;' > common/src/lib.rs \
    && for m in config db slug filters artists s3 progress lock checkpoint totals statistics types images; do echo '' > common/src/$m.rs; done \
    && echo 'fn main(){}' > index/src/main.rs \
    && echo 'fn main(){}' > sync/src/main.rs \
    && echo 'fn main(){}' > fix/src/main.rs \
    && echo 'fn main(){}' > analysis/src/main.rs \
    && echo 'fn main(){}' > nuke/src/main.rs \
    && echo 'fn main(){}' > audit/src/main.rs \
    && echo 'fn main(){}' > playlists/src/main.rs

# Build dependencies only (cached unless Cargo.toml changes)
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY common/src common/src
COPY index/src index/src
COPY sync/src sync/src
COPY fix/src fix/src
COPY analysis/src analysis/src
COPY nuke/src nuke/src
COPY audit/src audit/src
COPY playlists/src playlists/src

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
COPY --from=builder /build/target/release/index /usr/local/bin/
COPY --from=builder /build/target/release/sync /usr/local/bin/
COPY --from=builder /build/target/release/analysis /usr/local/bin/analysis
COPY --from=builder /build/target/release/nuke /usr/local/bin/
COPY --from=builder /build/target/release/audit /usr/local/bin/
COPY --from=builder /build/target/release/fix /usr/local/bin/
COPY --from=builder /build/target/release/playlists /usr/local/bin/

# Genre playlist groupings
COPY playlists/genre-groups.json /app/genre-groups.json

# No default CMD — run specific binaries as needed:
#   docker run --rm dmp-scripts index [args]
#   docker run --rm dmp-scripts sync [args]
