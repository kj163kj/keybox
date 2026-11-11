#!/bin/sh
set -eu
export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
mysql --protocol=TCP --host=db --user=root < /bootstrap/runtime-grants.sql
mysql --protocol=TCP --host=db --user=root <<'SQL'
GRANT 'keybox_runtime' TO 'keybox_app'@'%';
SET DEFAULT ROLE 'keybox_runtime' TO 'keybox_app'@'%';
SQL
unset MYSQL_PWD
printf 'Runtime grants applied.\n'
