FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY logger.mjs ./
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
