# Patchwork UI (Next.js)
# Multi-stage: bun install + next build (standalone) → node runtime

FROM oven/bun:latest AS builder

WORKDIR /build

# Copy workspace root files
COPY package.json tsconfig.base.json ./
COPY bun.lock* ./

# Copy packages needed for UI build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/server/package.json packages/server/
COPY packages/server/prisma packages/server/prisma
COPY packages/ui/ packages/ui/

# Install dependencies, generate Prisma client
# --frozen-lockfile is skipped to tolerate optional dep platform mismatches
RUN rm -f bun.lock && bun install && \
    cd packages/server && bun run prisma generate && cd ../..

# API_SERVER_URL must be available at build time because Next.js standalone
# bakes rewrites() into the route manifest during `next build`.
ARG API_SERVER_URL=http://server:3001
ENV API_SERVER_URL=${API_SERVER_URL}

# NEXT_PUBLIC_WS_URL is inlined by Next.js at build time (DefinePlugin).
# Points to the server's WebSocket endpoint when the UI is behind a
# reverse proxy that cannot route /ws to the server.
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

RUN bun run --filter @patchwork/shared build && \
    bun run --filter @patchwork/ui build

# --- Runtime ---
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next.js standalone output bundles all deps — no separate node_modules needed
COPY --from=builder /build/packages/ui/.next/standalone ./
COPY --from=builder /build/packages/ui/.next/static ./packages/ui/.next/static
COPY --from=builder /build/packages/ui/public ./packages/ui/public

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["node", "packages/ui/server.js"]
