"""Generate new deployment secrets ON THE SERVER, without printing their values.

Run from a fresh project directory. Existing state is never overwritten.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import urllib.parse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.origin)
    if (origin.scheme != "https" or not origin.netloc or origin.path or origin.query
            or origin.fragment or origin.username or "*" in args.origin
            or re.search(r"[\s\"'$`\\]", args.origin)):
        parser.error("origin must be one exact HTTPS origin without a path")
    if not re.fullmatch(r"[0-9a-f]{7,40}", args.revision):
        parser.error("revision must be a Git commit")
    if os.name != "posix" or os.geteuid() != 0:
        parser.error("run as root on the deployment server")
    if not Path("go.mod").is_file() or not Path("docker-compose.yml").is_file():
        parser.error("run from the prepared project directory")
    if Path("secrets").exists() or Path(".env").exists() or Path("data").exists():
        parser.error("existing deployment state found; will not regenerate or overwrite")

    os.umask(0o077)
    Path("secrets/api").mkdir(parents=True)
    # Parent secrets/ remains 0700. Only the mounted API subdirectory is traversable
    # by its unprivileged container user. Each service sees only its own mount.
    Path("secrets/api").chmod(0o755)

    def write_secret(name, value):
        path = Path("secrets") / name
        with path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(value + "\n")
        path.chmod(0o444)

    root_password, migrator_password, runtime_password = (secrets.token_urlsafe(32) for _ in range(3))
    write_secret("mysql_root_password", root_password)
    write_secret("mysql_migrator_password", migrator_password)
    write_secret("mysql_runtime_password", runtime_password)
    write_secret("migration_dsn", f"keybox_migrator:{migrator_password}@tcp(db:3306)/keybox?charset=utf8mb4")
    write_secret("api/db_dsn", f"keybox_app:{runtime_password}@tcp(db:3306)/keybox?charset=utf8mb4")
    random_key = lambda: base64.b64encode(secrets.token_bytes(32)).decode("ascii")
    write_secret("api/encryption_keys", json.dumps({"primary-v1": random_key()}))
    write_secret("api/ip_hash_key", random_key())
    write_secret("api/csrf_key", random_key())
    write_secret("api/setup_token", secrets.token_urlsafe(32))

    with Path(".env").open("x", encoding="utf-8", newline="\n") as output:
        output.write(f"KEYBOX_RELEASE={args.revision}\n")
        output.write(f"KEYBOX_ALLOWED_ORIGINS={args.origin}\n")
        output.write("KEYBOX_SETUP_TOKEN_FILE=/run/keybox/setup_token\n")
    Path("data").mkdir()
    print("Deployment configuration and independent random secrets created.")
    print("No administrator has been created; complete Web setup after HTTPS routing.")


if __name__ == "__main__":
    main()
