FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
