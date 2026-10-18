# ==========================================
# Stage 1: Install dependencies
# ==========================================
FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

# ==========================================
# Stage 2: Build the application
# ==========================================
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

RUN npm prune --production

# ==========================================
# Stage 3: Production Runtime
# ==========================================
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs prism

COPY --from=builder --chown=prism:nodejs /app/package.json ./
COPY --from=builder --chown=prism:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=prism:nodejs /app/dist ./dist

USER prism

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
