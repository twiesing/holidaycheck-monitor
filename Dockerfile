FROM mcr.microsoft.com/playwright:v1.61.1-noble AS base

WORKDIR /app

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .
RUN pnpm build

FROM base AS prod-deps

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json

RUN pnpm install --prod --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/holidaycheck-monitor.sqlite \
    HEADLESS=true

RUN mkdir -p /data && chown -R pwuser:pwuser /app /data

COPY --from=prod-deps --chown=pwuser:pwuser /app ./
COPY --from=build --chown=pwuser:pwuser /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=pwuser:pwuser /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=pwuser:pwuser /app/apps/web/dist ./apps/web/dist

USER pwuser

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "apps/server/dist/index.js"]
