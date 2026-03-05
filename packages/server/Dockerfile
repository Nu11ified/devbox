# Patchwork Server
# Multi-stage: bun build → bun runtime

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
FROM oven/bun:1-slim

WORKDIR /app

# Copy built output and schema
COPY --from=builder /build/packages/server/dist ./dist
COPY --from=builder /build/packages/server/src/db/schema.sql ./dist/db/schema.sql

# Copy the built @patchwork/shared package (workspace dep)
COPY --from=builder /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder /build/packages/shared/package.json ./packages/shared/

# Create a standalone package.json that replaces workspace:* with a file reference
# so bun install works outside the monorepo
COPY --from=builder /build/packages/server/package.json ./
RUN sed -i 's|"@patchwork/shared": "workspace:\*"|"@patchwork/shared": "file:./packages/shared"|' package.json

# Install production dependencies (resolves real packages, not symlinks)
RUN bun install --production

EXPOSE 3001

CMD ["bun", "run", "dist/index.js"]
