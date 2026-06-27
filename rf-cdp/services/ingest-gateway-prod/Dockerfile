# CDP ingest-gateway (production) — plain Node 18 / Fastify / undici / pino.
# Health: GET /v1/health  |  Port: $PORT (default 8110, binds 0.0.0.0)  |  Start: npm start
FROM node:18-alpine

ENV NODE_ENV=production \
    PORT=8110

WORKDIR /app

# Install production deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# Application code.
COPY server.js resend-webhook.js ./
COPY lib ./lib

# Drop privileges to the built-in non-root `node` user.
USER node

EXPOSE 8110

# Hit /v1/health via the bundled node runtime (no curl/wget on alpine).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8110,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
