#!/bin/sh
set -eu

migration_pid=
migration_signal=
forward_signal() {
  migration_signal=$1
  if [ -n "$migration_pid" ]; then
    kill "-$1" "$migration_pid" 2>/dev/null || :
  fi
}

echo '[web] migration start'
trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
node /app/migrator/dist/migrate.js &
migration_pid=$!
if [ -n "$migration_signal" ]; then
  kill "-$migration_signal" "$migration_pid" 2>/dev/null || :
fi
set +e
while :; do
  wait "$migration_pid"
  migration_status=$?
  kill -0 "$migration_pid" 2>/dev/null
  if [ "$?" -ne 0 ]; then
    break
  fi
done
set -e
trap - TERM INT

if [ "$migration_status" -ne 0 ]; then
  echo '[web] migration failed' >&2
  exit "$migration_status"
fi

echo '[web] migration succeeded'
exec "$@"
