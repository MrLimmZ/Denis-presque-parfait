FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package.json ./
RUN npm install --omit=dev --build-from-source

COPY server/ ./

RUN mkdir -p /data

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]