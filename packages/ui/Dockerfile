# Patchwork UI (Next.js)
# Multi-stage: bun install + next build → node runtime

FROM oven/bun:1 AS builder

WORKDIR /build

# Copy workspace root files
COPY package.json bun.lock tsconfig.base.json ./

# Copy packages needed for UI build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/ui/ packages/ui/

# Install dependencies and build
RUN bun install && \
    bun run --filter @patchwork/shared build && \
    bun run --filter @patchwork/ui build

# --- Runtime ---
FROM node:20-slim

WORKDIR /app

COPY --from=builder /build/packages/ui/.next ./.next
COPY --from=builder /build/packages/ui/public ./public
COPY --from=builder /build/packages/ui/package.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/ui/next.config.ts ./

EXPOSE 3000

CMD ["npx", "next", "start"]
