# =============================================================================
# apps/server — Multi-stage Dockerfile
# =============================================================================

# Stage 1: install dependencies
FROM node:20-alpine AS deps
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter grat-server...

# Stage 2: build
FROM node:20-alpine AS builder
RUN npm install -g pnpm@9
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY apps/server ./apps/server
COPY package.json pnpm-workspace.yaml ./
RUN pnpm --filter grat-server run build

# Stage 3: runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=deps /app/apps/server/node_modules ./node_modules
COPY --from=builder /app/apps/server/package.json ./package.json

EXPOSE 3001
CMD ["node", "dist/index.js"]
