# API image — build context = server/ (Railway: set Root Directory to "server").
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . ./
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
RUN npm prune --omit=dev
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "dist/index.js"]
