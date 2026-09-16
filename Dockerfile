# Build the workspace, then ship only what the server needs to run.
FROM node:22-slim AS build
WORKDIR /app

RUN corepack enable

# better-sqlite3 compiles a native addon.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY skills ./skills

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

# The database, blobs and dev master key live here. Mount a volume over it.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
