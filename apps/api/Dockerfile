# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
# Node 20 matches the repo (.nvmrc=20, root engines node>=20).
FROM node:20-slim AS build
WORKDIR /app

# Enable corepack + pnpm (version pinned in root package.json packageManager)
RUN corepack enable

# Copy the entire monorepo (build needs all workspaces)
COPY . .

# Install all dependencies from the committed lockfile, then build every package
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- Stage 2: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8110

# Copy the built workspace (dist outputs + resolved node_modules) from the build stage
COPY --from=build --chown=node:node /app ./

EXPOSE 8110

# Liveness/readiness probe against the API health endpoint.
# Uses $PORT (default 8110) so it stays correct if PORT is overridden at runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8110)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run as the unprivileged built-in node user
USER node

CMD ["node", "apps/api/dist/server.js"]
