# cdp-admin — operator profiles dashboard. Zero deps (Node 18 http + global fetch).
FROM node:18-alpine
ENV NODE_ENV=production \
    PORT=8120
WORKDIR /app
COPY server.js ./
USER node
EXPOSE 8120
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8120,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
