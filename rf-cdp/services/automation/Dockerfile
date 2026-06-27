# RF CDP automation — plain Node (no runtime deps). Scenario orchestrator with a
# 152-FZ marketing-messaging consent gate. Health: GET /v1/health | :8170.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8170

WORKDIR /app

COPY package.json ./
COPY worker.js ./
COPY lib ./lib

USER node

EXPOSE 8170

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8170,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "worker.js"]
