FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    python3 make g++ \
    chromium ffmpeg \
    ca-certificates ttf-freefont nss freetype harfbuzz

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY server/package.json ./
RUN npm install --omit=dev
RUN npm rebuild better-sqlite3 --build-from-source

COPY server/ ./

RUN mkdir -p /data

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]