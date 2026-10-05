#!/usr/bin/env bash
# Starts a throw-away PostgreSQL 16 on :54329 (for sandboxes / CI without Docker). Usage: pg-local.sh start|stop|reset
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; DATA=${DBL_PGDATA:-/var/tmp/dbl-pg}; PORT=${DBL_PGPORT:-54329}
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then mkdir -p "$DATA"; chown postgres "$DATA" 2>/dev/null || true; as_pg "$BIN/initdb -D $DATA -A trust -U postgres >/dev/null"; fi
    as_pg "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/log -w start" >/dev/null || true
    psql -h /tmp -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/bootstrap-roles.sql"
    echo "postgres ready on :$PORT" ;;
  stop)  as_pg "$BIN/pg_ctl -D $DATA -m fast stop" ;;
  reset) "$0" stop || true; rm -rf "$DATA"; "$0" start ;;
esac
