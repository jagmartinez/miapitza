#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "Applying database migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
else
  echo "WARNING: DATABASE_URL is not set — skipping database migrations."
fi

exec node dist/index.js
