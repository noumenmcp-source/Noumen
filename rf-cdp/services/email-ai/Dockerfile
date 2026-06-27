# RF CDP email-ai — plain Node (no runtime deps). AI marketing-email composer
# (152-FZ) over profile-engine + consent-ledger. Health: GET /v1/health | :8150.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8150

WORKDIR /app

COPY package.json ./
COPY worker.js ./
COPY lib ./lib

USER node

EXPOSE 8150

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8150,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "worker.js"]
