#!/bin/sh
set -eu
test -n "${1:-}" || { echo "usage: restore-postgres-check.sh backup.dump"; exit 2; }
trap 'dropdb -h postgres -U smoke --if-exists smoke_restore_check >/dev/null 2>&1 || true' EXIT
dropdb -h postgres -U smoke --if-exists smoke_restore_check
createdb -h postgres -U smoke smoke_restore_check
pg_restore -h postgres -U smoke -d smoke_restore_check "$1"
psql -h postgres -U smoke -d smoke_restore_check -v ON_ERROR_STOP=1 -c 'select count(*) from smoke_events;'
