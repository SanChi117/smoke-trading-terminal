#!/bin/sh
set -eu
umask 077
mkdir -p /backups
pg_dump -h postgres -U smoke -d smoke -Fc -f "/backups/smoke-$(date -u +%Y%m%dT%H%M%SZ).dump"
find /backups -type f -name 'smoke-*.dump' -mtime +14 -delete
