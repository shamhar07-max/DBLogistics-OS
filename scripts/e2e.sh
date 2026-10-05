#!/usr/bin/env bash
# Browser suites for both web apps against the LIVE stack. Each suite gets its OWN freshly seeded tenant, because the tests mutate
# data (dispatching trips, releasing holds, accepting quotes) and assume the seed's starting state.
# Requires: PostgreSQL, API on :3001, staff-web on :3000 and partner-portal on :3002 (`next dev`, never `next start`: dev login is refused there by design).
set -euo pipefail
cd "$(dirname "$0")/.."
seed() { local out; out=$(cd apps/api && SEED_SLUG="e2e-$1-$(date +%s)" npx tsx scripts/seed-dev.ts); printf '%s' "$out" | sed -n 's/.*"tenantId": "\([0-9a-f-]*\)".*/\1/p' | head -1; }
STAFF=$(seed staff); [ -n "$STAFF" ] || { echo "seed failed"; exit 1; }; echo "staff tenant $STAFF"
(cd apps/staff-web && TENANT_ID=$STAFF npx playwright test)
PORTAL=$(seed portal); [ -n "$PORTAL" ] || { echo "seed failed"; exit 1; }; echo "portal tenant $PORTAL"
(cd apps/partner-portal && TENANT_ID=$PORTAL npx playwright test)
