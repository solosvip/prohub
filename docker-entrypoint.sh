#!/usr/bin/env sh
set -e

# Initialize database (idempotent)
# Ensure data dirs exist at runtime
: ${DATA_DIR:=/data}
: ${UPLOAD_DIR:=/data/uploads}
mkdir -p "$UPLOAD_DIR" "$UPLOAD_DIR/thumbnails" "$UPLOAD_DIR/tmp"\nnode /app/server/scripts/initDb.js || true

exec node /app/server/index.js


