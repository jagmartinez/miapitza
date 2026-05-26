#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "Applying database schema (prisma db push)..."
  npx prisma db push --accept-data-loss --skip-generate
else
  echo "WARNING: DATABASE_URL is not set — skipping database schema sync."
fi

exec node dist/index.js
