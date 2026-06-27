# RF CDP profile-engine — plain Node (no runtime deps). Ported US core-cdp engine
# + materializer worker + read API. Health: GET /v1/health | Port: $PORT (8130).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8130

WORKDIR /app

# No runtime dependencies (engine is dependency-free); copy manifest for metadata.
COPY package.json ./
COPY worker.js ./
COPY lib ./lib

# Drop privileges to the built-in non-root `node` user.
USER node

EXPOSE 8130

# Probe /v1/health (unauthenticated) via the bundled node runtime (no curl on alpine).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8130,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "worker.js"]
