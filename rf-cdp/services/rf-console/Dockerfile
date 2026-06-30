# RF analytics console (AXIOM RU) — plain Node, no runtime deps.
# Server-side aggregates RF metrics from Elasticsearch. Health: GET /health.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8121
WORKDIR /app
COPY package.json ./
COPY server.js ./
USER node
EXPOSE 8121
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8121,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
