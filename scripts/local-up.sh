#!/usr/bin/env bash
# Runs the WHOLE Logistics OS locally in development mode (dev sign-in, local-disk documents, no cloud accounts):
#   PostgreSQL · Redis · ClamAV · Mailpit · API :3001 · worker · staff dashboard :3000 · partner portal :3002
# Needs: Node 22 and either Docker (recommended) or local PostgreSQL 16 + redis-server. Usage: bash scripts/local-up.sh   (stop: bash scripts/local-down.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
L="$PWD/.local"; mkdir -p "$L/files" "$L/logs"; : > "$L/pids"
say() { printf '\033[1;33m▸ %s\033[0m\n' "$*"; }
export DEV_AUTH_SECRET=dev-secret-dev-secret-dev-secret-00 SESSION_SECRET=session-secret-session-secret-session-secret-0
export DATABASE_URL=postgres://dbl_app:dbl_app_dev@localhost:54329/dbl WORKER_DATABASE_URL=postgres://dbl_worker:dbl_worker_dev@localhost:54329/dbl MIGRATION_DATABASE_URL=postgres://dbl_migrator:dbl_migrator_dev@localhost:54329/dbl
export REDIS_URL=redis://localhost:6379 DEV_STORAGE_DIR="$L/files" PORT=3001 API_BASE_URL=http://localhost:3001 CORS_ORIGINS=http://localhost:3000,http://localhost:3002
export SMTP_URL=smtp://localhost:1025 PORTAL_BASE_URL=http://localhost:3002

[ -d node_modules ] || { say "Installing dependencies (first run)"; npm ci; }

say "Infrastructure"
if docker info >/dev/null 2>&1; then
  docker compose up -d postgres redis mailpit clamav
  until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
else
  say "Docker not available: using local PostgreSQL / Redis binaries"
  bash infrastructure/local/pg-local.sh start
  command -v redis-server >/dev/null && { redis-cli ping >/dev/null 2>&1 || redis-server --port 6379 --save "" --appendonly no --daemonize yes >/dev/null; } || say "redis-server not found: the worker (notifications, scans, workflows) will not start"
fi

say "Database"
npx tsx scripts/local-db.ts
npm run db:migrate --silent

bg() { local name=$1; shift; ( "$@" > "$L/logs/$name.log" 2>&1 & echo $! >> $L/pids ); }
wait_http() { for _ in $(seq 1 90); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "timeout waiting for $1 (see $L/logs)"; return 1; }

say "API :3001"
( cd apps/api && DEV_AUTH_SECRET=$DEV_AUTH_SECRET bg api npx tsx src/main.ts ); wait_http http://localhost:3001/api/v1/health || true
SEED_SLUG=${SEED_SLUG:-local-demo}
if [ ! -f "$L/seeded" ]; then
  say "Demo data (tenant '$SEED_SLUG')"
  ( cd apps/api && SEED_SLUG=$SEED_SLUG npx tsx scripts/seed-dev.ts > "$L/seed.json" 2> "$L/logs/seed.err" ) && touch "$L/seeded" || { say "seed skipped (already seeded or failed: see $L/logs/seed.err)"; }
fi
TENANT=$(npx tsx scripts/local-db.ts tenant "$SEED_SLUG" 2>/dev/null | tail -1 || true)

if [ -z "$(redis-cli ping 2>/dev/null || true)" ] && ! docker info >/dev/null 2>&1; then :; else
  say "Worker"
  ( cd apps/worker && { nc -z localhost 3310 2>/dev/null && export CLAMD_HOST=localhost CLAMD_PORT=3310 || true; } && bg worker npx tsx src/main.ts )
fi
say "Staff dashboard :3000 and partner portal :3002 (first page load compiles; give it a few seconds)"
( cd apps/staff-web && bg staff-web npx next dev -p 3000 )
( cd apps/partner-portal && bg partner-portal npx next dev -p 3002 )
wait_http http://localhost:3000/login || true; wait_http http://localhost:3002/login || true

cat <<EOF

  Logistics OS is running locally.
    Staff dashboard   http://localhost:3000    sign in with subject  layla (owner) — or omar sales, nadia pricing, faisal finance, sana accountant, rami freight_ops, cem customs…
    Partner portal    http://localhost:3002    pharma-user / foods-user (customers), agent-user, haulier-user
    Tenant id         ${TENANT:-unknown}   (paste it into the login form's tenant field)
    Mail catcher      http://localhost:8025    API http://localhost:3001/api/v1   logs in $L/logs
  Stop everything:    bash scripts/local-down.sh
EOF
