# Stage 1: Build all Rust binaries
FROM rust:1-bookworm AS builder

WORKDIR /build

# Create a virtual workspace so all scripts share compiled dependencies
RUN cat > Cargo.toml <<'TOML'
[workspace]
members = ["sync", "analysis", "clean", "nuke", "audit", "genre-playlists", "delete"]
resolver = "2"
TOML

# Copy all Cargo.toml files first (dependency layer caching)
COPY sync/Cargo.toml sync/Cargo.toml
COPY analysis/Cargo.toml analysis/Cargo.toml
COPY clean/Cargo.toml clean/Cargo.toml
COPY nuke/Cargo.toml nuke/Cargo.toml
COPY audit/Cargo.toml audit/Cargo.toml
COPY genre-playlists/Cargo.toml genre-playlists/Cargo.toml
COPY delete/Cargo.toml delete/Cargo.toml

# Create dummy src files to pre-build dependencies
RUN mkdir -p sync/src analysis/src clean/src nuke/src audit/src genre-playlists/src delete/src \
    && echo 'fn main(){}' > sync/src/main.rs \
    && echo 'fn main(){}' > analysis/src/main.rs \
    && echo 'fn main(){}' > clean/src/main.rs \
    && echo 'fn main(){}' > nuke/src/main.rs \
    && echo 'fn main(){}' > audit/src/main.rs \
    && echo 'fn main(){}' > genre-playlists/src/main.rs \
    && echo 'fn main(){}' > delete/src/main.rs

# Build dependencies only (cached unless Cargo.toml changes)
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY sync/src sync/src
COPY analysis/src analysis/src
COPY clean/src clean/src
COPY nuke/src nuke/src
COPY audit/src audit/src
COPY genre-playlists/src genre-playlists/src
COPY delete/src delete/src

# Touch source files to invalidate the dummy build
RUN touch sync/src/main.rs analysis/src/main.rs clean/src/main.rs nuke/src/main.rs audit/src/main.rs genre-playlists/src/main.rs delete/src/main.rs

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
COPY --from=builder /build/target/release/dmp-sync /usr/local/bin/
COPY --from=builder /build/target/release/analysis /usr/local/bin/dmp-analysis
COPY --from=builder /build/target/release/dmp-clean /usr/local/bin/
COPY --from=builder /build/target/release/dmp-nuke /usr/local/bin/
COPY --from=builder /build/target/release/dmp-audit /usr/local/bin/
COPY --from=builder /build/target/release/dmp-genre-playlists /usr/local/bin/
COPY --from=builder /build/target/release/dmp-delete /usr/local/bin/

# Genre playlist groupings — dmp-genre-playlists looks for genre-groups.json
# in the working directory (WORKDIR=/app), so place it there.
COPY genre-playlists/genre-groups.json /app/genre-groups.json

# No default CMD — run specific binaries as needed:
#   docker run --rm dmp-scripts dmp-sync [args]
