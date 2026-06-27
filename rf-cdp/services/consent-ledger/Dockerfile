# RF CDP consent-ledger — plain Node (no runtime deps). 152-FZ signed consent
# chain from gateway receipts + read/verify API. Health: GET /v1/health | :8140.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8140

WORKDIR /app

COPY package.json ./
COPY worker.js ./
COPY lib ./lib

USER node

EXPOSE 8140

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8140,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "worker.js"]
