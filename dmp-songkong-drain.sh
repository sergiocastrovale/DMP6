#!/bin/sh
# Cron consumer of the DMP SongKong spool. The dmp container (no docker socket) drops one file per
# finished download into spool/<downloadId> containing the album path (/downloads/...); we run the
# enrich scan on it and, on success, write done/<downloadId> for the dmp reconcile loop to pick up.
# Failures leave the spool entry in place so the next tick retries.
set -u
STATE="/mnt/SSD/Downloads/.dmp-songkong"
SPOOL="$STATE/spool"
DONE="$STATE/done"
SCAN="$(dirname "$0")/dmp-songkong-scan.sh"

exec 9>"$STATE/drain.lock"
flock -n 9 || exit 0
[ -d "$SPOOL" ] || exit 0
mkdir -p "$DONE"

for f in "$SPOOL"/*; do
  [ -e "$f" ] || continue
  id="$(basename "$f")"
  path="$(cat "$f")"
  echo "$(date "+%F %T") draining: $id -> $path"
  if sh "$SCAN" "$path"; then
    : > "$DONE/$id"
    rm -f "$f"
    echo "$(date "+%F %T") done: $id"
  else
    echo "$(date "+%F %T") FAILED (will retry): $id"
  fi
done
