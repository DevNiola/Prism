# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter grat-web...

# Stage 2: Build
FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=deps /app ./
COPY apps/web ./apps/web
COPY scripts ./scripts
COPY crates/core/src/taxonomy ./crates/core/src/taxonomy

RUN pnpm run build:taxonomy && pnpm --filter grat-web build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root user
USER node

COPY --chown=node:node --from=builder /app/apps/web/package.json ./package.json
COPY --chown=node:node --from=builder /app/apps/web/.next ./.next
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node_modules/.bin/next", "start", "apps/web"]
