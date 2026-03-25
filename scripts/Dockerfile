# Stage 1: Build all Rust binaries
FROM rust:1-bookworm AS builder

WORKDIR /build

# Create a virtual workspace so all scripts share compiled dependencies
RUN cat > Cargo.toml <<'TOML'
[workspace]
members = ["index", "sync", "analysis", "clean", "nuke"]
resolver = "2"
TOML

# Copy all Cargo.toml files first (dependency layer caching)
COPY index/Cargo.toml index/Cargo.toml
COPY sync/Cargo.toml sync/Cargo.toml
COPY analysis/Cargo.toml analysis/Cargo.toml
COPY clean/Cargo.toml clean/Cargo.toml
COPY nuke/Cargo.toml nuke/Cargo.toml

# Create dummy src files to pre-build dependencies
RUN mkdir -p index/src sync/src analysis/src clean/src nuke/src \
    && echo 'fn main(){}' > index/src/main.rs \
    && echo 'fn main(){}' > sync/src/main.rs \
    && echo 'fn main(){}' > analysis/src/main.rs \
    && echo 'fn main(){}' > clean/src/main.rs \
    && echo 'fn main(){}' > nuke/src/main.rs

# Build dependencies only (cached unless Cargo.toml changes)
RUN cargo build --release --workspace 2>/dev/null || true

# Copy actual source code
COPY index/src index/src
COPY sync/src sync/src
COPY analysis/src analysis/src
COPY clean/src clean/src
COPY nuke/src nuke/src

# Touch source files to invalidate the dummy build
RUN touch index/src/main.rs sync/src/main.rs analysis/src/main.rs clean/src/main.rs nuke/src/main.rs

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

# No default CMD — run specific binaries as needed:
#   docker run --rm dmp-scripts dmp-index [args]
#   docker run --rm dmp-scripts dmp-sync [args]
