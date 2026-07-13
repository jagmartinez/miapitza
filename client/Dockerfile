FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_PROXY_ENABLED=true
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN test -n "$VITE_API_URL" || (echo "FATAL: VITE_API_URL is required for the production image" && exit 1)
RUN test -n "$VITE_WS_URL" || (echo "FATAL: VITE_WS_URL is required for the production image" && exit 1)
RUN npm run build

FROM nginx:1.27-alpine AS runner
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV PORT=8080
# Substitute only deployment variables; preserve nginx variables such as $uri.
ENV NGINX_ENVSUBST_FILTER="^(PORT|VITE_API_URL)$"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/" || exit 1
