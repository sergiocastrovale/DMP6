# Stage 1: Build
FROM node:20-bullseye AS builder

WORKDIR /build

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files first (Docker layer caching)
COPY package.json pnpm-lock.yaml ./
COPY prisma/schema.prisma prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate

# Copy source files
COPY . .

# Build Nuxt app
RUN pnpm build

# Stage 2: Production
FROM node:20-bullseye-slim

WORKDIR /app

# Copy built output
COPY --from=builder /build/.output .output/
COPY --from=builder /build/prisma/schema.prisma prisma/schema.prisma

# Prisma CLI for db push on deploy (pinned to match project version)
RUN npm install -g prisma@6

# Create mount point directories
RUN mkdir -p /app/data/img/artists /app/data/img/releases /app/data/dump

ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/stats').then(r=>{if(!r.ok)throw 1;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
