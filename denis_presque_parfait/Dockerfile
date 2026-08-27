FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./
RUN npm install --omit=dev

COPY server/ ./

# /data est le volume persistant fourni par le Supervisor HA
RUN mkdir -p /data

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]