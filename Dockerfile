# API image — build context = repository root (Railway: leave "Root Directory" empty).
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/ ./
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
RUN npm prune --omit=dev
RUN chmod +x docker-entrypoint.sh
RUN mkdir -p uploads
EXPOSE 3001
CMD ["./docker-entrypoint.sh"]
