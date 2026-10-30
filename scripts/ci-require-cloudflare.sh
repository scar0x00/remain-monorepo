#!/usr/bin/env bash
# Fails with a readable message when the Cloudflare secrets the remote AI binding needs are missing.
set -euo pipefail

missing=0
for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Repository secret $name is not set (Settings > Secrets and variables > Actions)."
    missing=1
  fi
done
exit "$missing"
