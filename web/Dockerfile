# Stage 1: Build
FROM node:20-bullseye AS builder

# mediasoup requires python3, make, g++ for C++ worker compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files first (Docker layer caching)
COPY package.json pnpm-lock.yaml ./
COPY prisma/schema.prisma prisma/

# Install dependencies (triggers mediasoup C++ build + Prisma engine download)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate

# Copy source files
COPY . .

# Build Nuxt app
ARG PARTY_ROLE=listener
ARG PARTY_ENABLED=false
ENV PARTY_ROLE=${PARTY_ROLE}
ENV PARTY_ENABLED=${PARTY_ENABLED}
RUN pnpm build

# Copy mediasoup worker binary into the build output
RUN mkdir -p .output/server/node_modules/mediasoup/worker/out/Release \
    && cp -r node_modules/mediasoup/worker/out/Release/* \
       .output/server/node_modules/mediasoup/worker/out/Release/

# Stage 2: Production
FROM node:20-bullseye-slim

WORKDIR /app

# Copy built output
COPY --from=builder /build/.output .output/

# Create mount point directories
RUN mkdir -p /app/data/img/artists /app/data/img/releases /app/data/dump

ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/stats').then(r=>{if(!r.ok)throw 1;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
