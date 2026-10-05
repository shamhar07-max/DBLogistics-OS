#!/usr/bin/env bash
# Browser suites for both web apps against the LIVE stack. Seeds a FRESH tenant first, because the tests mutate data
# (dispatching trips, releasing holds, accepting quotes) and assume the seed's starting state.
# Requires: PostgreSQL, API on :3001, staff-web on :3000 and partner-portal on :3002 (`next dev`, never `next start`: dev login is refused there by design).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(cd apps/api && SEED_SLUG="e2e-$(date +%s)" npx tsx scripts/seed-dev.ts)
export TENANT_ID=$(printf '%s' "$OUT" | sed -n 's/.*"tenantId": "\([0-9a-f-]*\)".*/\1/p' | head -1)
[ -n "$TENANT_ID" ] || { echo "seed failed:"; echo "$OUT"; exit 1; }
echo "tenant $TENANT_ID"
(cd apps/staff-web && npx playwright test) && (cd apps/partner-portal && npx playwright test)
