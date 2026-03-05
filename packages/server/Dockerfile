# Patchwork Server
# Multi-stage: bun build → node runtime

FROM oven/bun:1 AS builder

WORKDIR /build

# Copy workspace root files
COPY package.json bun.lock tsconfig.base.json ./

# Copy packages needed for server build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src

# Install dependencies and build
RUN bun install && \
    bun run --filter @patchwork/shared build && \
    bun run --filter @patchwork/server build

# --- Runtime ---
FROM node:20-slim

WORKDIR /app

# Copy built output and production node_modules
COPY --from=builder /build/packages/server/dist ./dist
COPY --from=builder /build/packages/server/src/db/schema.sql ./dist/db/schema.sql
COPY --from=builder /build/packages/server/package.json ./
COPY --from=builder /build/packages/shared/dist ./node_modules/@patchwork/shared/dist
COPY --from=builder /build/packages/shared/package.json ./node_modules/@patchwork/shared/
COPY --from=builder /build/node_modules ./node_modules

EXPOSE 3001

CMD ["node", "dist/index.js"]
