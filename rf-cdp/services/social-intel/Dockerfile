# RF CDP social-intel — plain Node (no runtime deps). Deterministic social/intent
# + YouTube analysis API. Health: GET /v1/health | Port: $PORT (8160).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8160

WORKDIR /app

COPY package.json ./
COPY worker.js ./
COPY lib ./lib

USER node

EXPOSE 8160

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8160,path:'/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "worker.js"]
