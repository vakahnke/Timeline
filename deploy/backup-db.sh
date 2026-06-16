#!/usr/bin/env bash
# Back up the production Postgres database to ./backups (gzipped pg_dump), rotating old
# dumps. Optionally uploads to S3 if S3_BACKUP_BUCKET is set (needs awscli + an IAM role).
#
#   ./deploy/backup-db.sh
#   # cron (daily at 03:00):
#   0 3 * * * cd /opt/timeline && ./deploy/backup-db.sh >> backups/backup.log 2>&1
#
# Restore:
#   gunzip -c backups/<file>.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${POSTGRES_USER:?}"; : "${POSTGRES_DB:?}"

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p backups
ts=$(date +%Y%m%d-%H%M%S)
file="backups/${POSTGRES_DB}-${ts}.sql.gz"

echo "[$(date)] dumping ${POSTGRES_DB} -> ${file}"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${file}"

# Rotate local dumps older than KEEP_DAYS.
find backups -name "${POSTGRES_DB}-*.sql.gz" -type f -mtime +"${KEEP_DAYS}" -delete

# Optional off-box copy.
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  aws s3 cp "${file}" "s3://${S3_BACKUP_BUCKET}/$(basename "${file}")"
  echo "[$(date)] uploaded to s3://${S3_BACKUP_BUCKET}/"
fi

echo "[$(date)] backup complete"
