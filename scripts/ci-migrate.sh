#!/usr/bin/env bash
# Applies the better-auth and decks migrations, in that order, to the Postgres in
# CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG. Used by .github/workflows/tests.yml.
set -euo pipefail

BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")/../main-backend" && pwd)"
for file in "$BACKEND"/better-auth_migrations/*.sql "$BACKEND"/migrations/*.sql; do
  echo "Applying ${file#"$BACKEND"/}"
  psql "$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG" -q -v ON_ERROR_STOP=1 -f "$file"
done
