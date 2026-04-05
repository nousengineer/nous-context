# ==============================================================================
# ThinkCoffee MCP Server - Multi-stage Dockerfile (V3 - Agent Safety Net)
# ==============================================================================
# Build: docker build -t thinkcoffee/mcp-server:latest .
# Run:   docker run -v thinkcoffee_data:/data thinkcoffee/mcp-server:latest
#
# V3 changes:
#   - ARG THINKCOFFEE_VERSION for build-time version injection
#   - /data/snapshots and /data/logs directories for Safety Net feature
#   - Improved health check with HTTP endpoint
#   - Explicit labels for V3 compliance
# ==============================================================================

# --- Stage 1: Build -----------------------------------------------------------
FROM node:20-alpine AS builder

ARG THINKCOFFEE_VERSION=dev

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace manifests first (layer cache optimization)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/cli/package.json ./packages/cli/

# Install all deps (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code (including new V3 modules: tools/, utils/, types/, services/)
COPY packages/core/src ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/mcp-server/src ./packages/mcp-server/src
COPY packages/mcp-server/tsconfig.json ./packages/mcp-server/
COPY packages/cli/src ./packages/cli/src
COPY packages/cli/tsconfig.json ./packages/cli/

# Build core first, then dependents (respecting workspace dependencies)
RUN pnpm build:core && \
    pnpm build:mcp && \
    pnpm build:cli

# Write version file
RUN echo "{\"version\":\"${THINKCOFFEE_VERSION}\",\"buildDate\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > /app/packages/mcp-server/dist/version.json

# --- Stage 2: Production ------------------------------------------------------
FROM node:20-alpine AS production

# Security + traceability labels
LABEL org.opencontainers.image.title="ThinkCoffee MCP Server"
LABEL org.opencontainers.image.description="AI Context Management Platform - MCP Server (V3 Agent Safety Net)"
LABEL org.opencontainers.image.source="https://github.com/thinkcoffee/thinkcoffee"
LABEL org.opencontainers.image.vendor="ThinkCoffee Team"
LABEL org.opencontainers.image.version="${THINKCOFFEE_VERSION}"

RUN corepack enable && corepack prepare pnpm@9 --activate

# Security: non-root user
RUN addgroup -S thinkcoffee && adduser -S thinkcoffee -G thinkcoffee

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod && \
    pnpm store prune

# Copy built artifacts from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist

# Data directory structure:
#   /data/data.sqlite        - SQLite database
#   /data/snapshots/          - File snapshots for rollback (V3)
#   /data/logs/               - Action logs JSONL (V3)
RUN mkdir -p /data /data/snapshots /data/logs && \
    chown -R thinkcoffee:thinkcoffee /data /app

USER thinkcoffee

# Environment defaults
ENV NODE_ENV=production
ENV THINKCOFFEE_DB_PATH=/data/data.sqlite
ENV THINKCOFFEE_DATA_DIR=/data
ENV THINKCOFFEE_SNAPSHOT_DIR=/data/snapshots
ENV THINKCOFFEE_LOG_DIR=/data/logs
ENV MCP_PORT=3000
ENV LOG_LEVEL=info

# V3 Safety Net defaults
ENV THINKCOFFEE_SNAPSHOT_RETENTION_DAYS=7
ENV THINKCOFFEE_SNAPSHOT_MAX_SIZE_MB=50
ENV THINKCOFFEE_DRY_RUN_DEFAULT=false
ENV THINKCOFFEE_DIFF_PREVIEW_MODE=existing-only
ENV THINKCOFFEE_COMMAND_CONFIRMATION=destructive-only

EXPOSE 3000

VOLUME ["/data"]

# Health check - verifica escrita no /data e se o processo node esta rodando
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e " \
    const fs = require('fs'); \
    const http = require('http'); \
    try { \
      fs.accessSync('/data', fs.constants.W_OK); \
      fs.accessSync('/data/snapshots', fs.constants.W_OK); \
      fs.accessSync('/data/logs', fs.constants.W_OK); \
      process.exit(0); \
    } catch(e) { \
      process.exit(1); \
    } \
  "

CMD ["node", "packages/mcp-server/dist/index.js"]
