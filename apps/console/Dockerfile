# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
# Build from the repository root so pnpm workspaces and the Next standalone trace resolve.
FROM node:20-slim AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=https://noumen.137-220-56-211.sslip.io
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Optional read-only demo workspace: when set, the dashboard auto-loads live
# aggregates for this tenant so the public URL renders a populated cockpit.
ARG NEXT_PUBLIC_DEMO_TENANT=
ARG NEXT_PUBLIC_DEMO_TOKEN=
ENV NEXT_PUBLIC_DEMO_TENANT=$NEXT_PUBLIC_DEMO_TENANT
ENV NEXT_PUBLIC_DEMO_TOKEN=$NEXT_PUBLIC_DEMO_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/console/package.json ./apps/console/package.json

RUN pnpm --filter @cdp-us/console install --frozen-lockfile

COPY apps/console ./apps/console

RUN pnpm --filter @cdp-us/console build

# ---- Stage 2: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8120
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/apps/console/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/console/.next/static ./apps/console/.next/static

EXPOSE 8120

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8120)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "apps/console/server.js"]
