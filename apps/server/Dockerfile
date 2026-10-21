FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --filter grat-server --frozen-lockfile
COPY apps/server/ apps/server/
RUN pnpm --filter grat-server build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --filter grat-server --prod --frozen-lockfile
COPY --from=build /app/apps/server/dist ./apps/server/dist

EXPOSE 3001
CMD ["pnpm", "--filter", "grat-server", "start"]
