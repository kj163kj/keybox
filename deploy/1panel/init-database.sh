#!/bin/bash
# Sourced by the official MySQL entrypoint after it creates the migrator.
# Do not enable shell tracing: this function passes a password via stdin.
runtime_password="$(cat /run/secrets/mysql_runtime_password)"
case "$runtime_password" in
  ''|*[!A-Za-z0-9_-]*) echo "Invalid runtime secret format" >&2; exit 1 ;;
esac
docker_process_sql <<SQL
CREATE USER 'keybox_app'@'%' IDENTIFIED BY '${runtime_password}';
SQL
unset runtime_password
