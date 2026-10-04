#!/bin/sh
set -e

DB_FILE="${DB_PATH:-/app/backend/trustdesk.db}"
mkdir -p "$(dirname "$DB_FILE")"

if [ ! -f "$DB_FILE" ]; then
  echo "No existing database found at $DB_FILE — seeding..."
  node src/db/seed.js
else
  echo "Existing database found at $DB_FILE — skipping seed."
fi

echo "Starting TrustDesk backend..."
exec node src/server.js