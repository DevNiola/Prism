FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
RUN pnpm --filter grat-server install --frozen-lockfile

FROM deps AS build
COPY apps/server ./apps/server
RUN pnpm --filter grat-server build:container

FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
RUN pnpm --filter grat-server install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist

USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
