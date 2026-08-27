FROM node:20-alpine

WORKDIR /app

# Outils nécessaires pour compiler les modules natifs
RUN apk add --no-cache python3 make g++

COPY server/package.json ./
RUN npm install --omit=dev
RUN npm rebuild better-sqlite3 --build-from-source

COPY server/ ./

# /data est le volume persistant fourni par le Supervisor HA
RUN mkdir -p /data

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]