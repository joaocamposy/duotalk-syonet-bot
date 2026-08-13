# Multi-stage build com a imagem oficial do Playwright
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.50.0-noble AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HEADLESS=true

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Diretorios para persistencia de logs e fila
RUN mkdir -p logs data storage

EXPOSE 3000

CMD ["node", "dist/server.js"]
