#!/bin/sh
set -e

# Mirror server/src/utils/prisma.ts so migrations run when Railway (or similar)
# exposes MYSQL* parts / MYSQL_URL instead of DATABASE_URL.
if [ -z "$DATABASE_URL" ]; then
  if [ -n "$MYSQL_URL" ]; then
    DATABASE_URL="$MYSQL_URL"
  elif [ -n "$MYSQLURL" ]; then
    DATABASE_URL="$MYSQLURL"
  else
    _host="${MYSQLHOST:-${MYSQL_HOST:-}}"
    _port="${MYSQLPORT:-${MYSQL_PORT:-3306}}"
    _user="${MYSQLUSER:-${MYSQL_USER:-}}"
    _password="${MYSQLPASSWORD:-${MYSQL_PASSWORD:-}}"
    _database="${MYSQLDATABASE:-${MYSQL_DATABASE:-}}"
    if [ -n "$_host" ] && [ -n "$_user" ] && [ -n "$_database" ]; then
      DATABASE_URL="mysql://${_user}:${_password}@${_host}:${_port}/${_database}"
    fi
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: Missing DATABASE_URL."
  echo "  Set DATABASE_URL on this service, or link a MySQL plugin and reference its URL."
  echo "  Supported fallbacks: MYSQL_URL / MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE."
  exit 1
fi

export DATABASE_URL

# Railway mounts persistent volumes after the image is built, normally owned by
# root. Initialize only the configured storage mount, then run the application
# as the unprivileged node user. Local/non-root containers remain unchanged.
if [ "$(id -u)" = "0" ]; then
  _storage_dir="${STORAGE_DIR:-/app/storage}"
  mkdir -p "$_storage_dir/uploads/invoices" "$_storage_dir/backups"
  chown -R node:node "$_storage_dir"
fi

echo "Syncing database schema..."
# Production must fail closed. `db push --accept-data-loss` is intentionally
# forbidden here: a migration failure must never turn into an implicit,
# potentially destructive schema rewrite.
npx prisma migrate deploy

if [ "$(id -u)" = "0" ]; then
  exec gosu node node dist/index.js
fi

exec node dist/index.js
