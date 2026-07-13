FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN test -n "$VITE_API_URL" || (echo "FATAL: VITE_API_URL is required for the production image" && exit 1)
RUN test -n "$VITE_WS_URL" || (echo "FATAL: VITE_WS_URL is required for the production image" && exit 1)
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "./node_modules/.bin/serve -s dist -l tcp://0.0.0.0:${PORT:-8080}"]
