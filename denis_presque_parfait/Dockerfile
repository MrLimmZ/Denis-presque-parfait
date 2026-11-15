FROM node:20-alpine

# Métadonnées attendues par le Supervisor Home Assistant pour une image d'add-on
# préconstruite (voir .github/workflows/build.yml, qui fournit ces valeurs).
ARG BUILD_VERSION=dev
ARG BUILD_ARCH=aarch64
LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="addon" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/MrLimmZ/Denis-presque-parfait" \
      org.opencontainers.image.description="Un Denis Presque Parfait - add-on Home Assistant"

WORKDIR /app

# Chromium + ffmpeg : génération de la vidéo des résultats. tzdata : fuseau horaire.
# Pas d'outils de compilation : better-sqlite3 est téléchargé précompilé
# (binaire linuxmusl-arm64 publié pour Node 20).
RUN apk add --no-cache \
    chromium ffmpeg \
    ca-certificates ttf-freefont nss freetype harfbuzz tzdata

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Dépendances d'abord (couche mise en cache tant que package*.json ne changent pas).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./

RUN mkdir -p /data

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]
