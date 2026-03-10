# Patchwork Server
# Multi-stage: bun build → bun runtime

FROM oven/bun:latest AS builder

WORKDIR /build

# Copy workspace root files
COPY package.json tsconfig.base.json ./
COPY bun.lock* ./

# Copy packages needed for server build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src
COPY packages/server/prisma packages/server/prisma

# Install dependencies, generate Prisma client, and build
# --frozen-lockfile is skipped to tolerate optional dep platform mismatches
RUN rm -f bun.lock && bun install && \
    cd packages/server && bun run prisma generate && cd ../.. && \
    bun run --filter @patchwork/shared build && \
    bun run --filter @patchwork/server build

# Prepare a clean production install for the server
# Remove workspace dep, install only external packages, then add shared manually
RUN cp packages/server/package.json /tmp/server-package.json && \
    sed -i '/"@patchwork\/shared"/d' /tmp/server-package.json && \
    mkdir -p /prod && \
    cp /tmp/server-package.json /prod/package.json && \
    cp -r packages/server/prisma /prod/prisma && \
    cd /prod && \
    bun install --production && \
    bunx prisma generate

# --- Runtime ---
FROM oven/bun:slim

RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built server output, schema, and prisma files
COPY --from=builder /build/packages/server/dist ./dist
COPY --from=builder /build/packages/server/src/db/schema.sql ./dist/db/schema.sql
COPY --from=builder /build/packages/server/prisma ./prisma
COPY --from=builder /build/packages/server/package.json ./

# Copy production node_modules (installed without workspace deps)
COPY --from=builder /prod/node_modules ./node_modules

# Add @patchwork/shared built output directly into node_modules
COPY --from=builder /build/packages/shared/dist ./node_modules/@patchwork/shared/dist
COPY --from=builder /build/packages/shared/package.json ./node_modules/@patchwork/shared/

EXPOSE 3001

CMD ["bun", "run", "dist/index.js"]
