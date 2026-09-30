# syntax=docker/dockerfile:1.7

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ARG OCI_SOURCE=https://github.com/takano536/kobako
ARG OCI_REVISION=unknown
ARG OCI_VERSION=unknown
LABEL org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.description="kobako production image"
WORKDIR /app

FROM node:24.21.0-bookworm-slim AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

FROM toolchain AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,id=kobako-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm --filter @kobako/db build
RUN pnpm --filter @kobako/web build
RUN pnpm --filter @kobako/worker build
RUN pnpm --filter @kobako/db deploy --prod /out/db
RUN pnpm --filter @kobako/worker deploy --prod /out/worker

FROM runtime AS web
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# Keep `dist` and `drizzle` together: migrate.ts resolves `../drizzle` from `dist/migrate.js`.
COPY --from=build --chown=node:node /out/db ./migrator
COPY --chown=node:node --chmod=0555 docker-entrypoint.sh /app/docker-entrypoint.sh
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]

FROM runtime AS migrate
COPY --from=build --chown=node:node /out/db ./
USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/migrate.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
