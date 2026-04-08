# API image — build context = repository root (Railway: leave "Root Directory" empty).
FROM node:20-bookworm-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/ ./
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
RUN npm prune --omit=dev
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "dist/index.js"]
