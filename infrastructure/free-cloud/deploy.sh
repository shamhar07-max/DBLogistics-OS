#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo 'Generate .env with scripts/configure-free-cloud.mjs, then configure domains and credentials.' >&2
  exit 1
fi
args=(--env-file .env -f compose.yaml)
if [[ "${1:-}" == supabase ]]; then args+=(-f compose.supabase.yaml); fi
if [[ "${1:-}" != '' && "${1:-}" != supabase ]]; then echo 'Usage: bash deploy.sh [supabase]' >&2; exit 1; fi
# Validate interpolation without printing rendered secrets.
docker compose "${args[@]}" config --quiet
export COMPOSE_PARALLEL_LIMIT=1
docker compose "${args[@]}" --profile setup build
# The setup order avoids racing identity database creation and realm import.
docker compose "${args[@]}" up -d --wait postgres
docker compose "${args[@]}" run --rm identity-setup
docker compose "${args[@]}" run --rm database-setup
docker compose "${args[@]}" up -d keycloak tunnel
echo 'Wait for the identity HTTPS origin /realms/dbl to respond, then run owner-setup as documented.'
echo 'After owner-setup succeeds, start api and staff. Optional portal and automation profiles are documented in README.md.'
