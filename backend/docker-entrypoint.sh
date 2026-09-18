#!/bin/sh
set -e

# Cloud Run's filesystem is read-only outside /tmp; SQLite lives there.
# Each cold start gets a fresh, freshly-seeded demo database.
export DATABASE_URL="file:/tmp/dev.db"

npx prisma db push --skip-generate --accept-data-loss
npx tsx prisma/seed.ts

exec node dist/index.js
