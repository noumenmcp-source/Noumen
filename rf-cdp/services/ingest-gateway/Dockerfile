FROM node:20

WORKDIR /usr/src/app

COPY package.json ./
COPY tsconfig.json ./
RUN npm install --production

COPY src ./src

RUN npm run build

CMD ["node", "dist/server.js"]