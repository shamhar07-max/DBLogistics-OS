#!/usr/bin/env bash
# Stops the processes started by local-up.sh (by recorded PID — never by name) and, with --infra, the containers.
cd "$(dirname "$0")/.."
[ -f .local/pids ] && while read -r p; do kill "$p" 2>/dev/null || true; done < .local/pids; : > .local/pids 2>/dev/null || true
for port in 3000 3001 3002; do pid=$(ss -ltnp 2>/dev/null | sed -n "s/.*:$port .*pid=\([0-9]*\).*/\1/p" | head -1); [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
[ "${1:-}" = "--infra" ] && { docker compose down 2>/dev/null || bash infrastructure/local/pg-local.sh stop; }
echo stopped
