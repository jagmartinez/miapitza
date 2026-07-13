# API image — build context = repository root (Railway: leave "Root Directory" empty).
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates default-mysql-client gosu \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/ ./
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage
RUN npm prune --omit=dev
RUN chmod +x docker-entrypoint.sh
RUN mkdir -p /app/storage/uploads/invoices /app/storage/backups
# Run as the unprivileged `node` user (built into the base image) instead of root.
RUN chown -R node:node /app
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
