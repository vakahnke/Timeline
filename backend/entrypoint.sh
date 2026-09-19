#!/usr/bin/env sh
set -e

# Where to wait for Postgres: POSTGRES_HOST/PORT if set, else parsed from DATABASE_URL
# (managed hosts like Railway only provide the URL).
if [ -z "${POSTGRES_HOST:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  eval "$(python - <<'PY'
import os
from urllib.parse import urlparse
u = urlparse(os.environ['DATABASE_URL'])
print(f'DB_HOST={u.hostname or "db"}; DB_PORT={u.port or 5432}')
PY
)"
else
  DB_HOST="${POSTGRES_HOST:-db}"
  DB_PORT="${POSTGRES_PORT:-5432}"
fi

echo "Waiting for Postgres at ${DB_HOST}:${DB_PORT}..."
until nc -z "$DB_HOST" "$DB_PORT"; do
  sleep 1
done
echo "Postgres is up."

python manage.py migrate --noinput

if [ "${RUN_COLLECTSTATIC:-1}" = "1" ]; then
  python manage.py collectstatic --noinput
fi

if [ "${SEED_DEMO:-0}" = "1" ]; then
  # Idempotent: load_sample skips projects that already exist.
  python manage.py load_sample
fi

exec "$@"
