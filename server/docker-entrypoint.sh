#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "Syncing database schema..."
  set +e
  npx prisma migrate deploy
  migrate_status=$?
  set -e
  if [ "$migrate_status" -ne 0 ]; then
    echo "migrate deploy failed (code $migrate_status); falling back to prisma db push..."
    npx prisma db push --accept-data-loss --skip-generate
  fi
else
  echo "WARNING: DATABASE_URL is not set — skipping database schema sync."
fi

exec node dist/index.js
