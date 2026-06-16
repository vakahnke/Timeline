#!/usr/bin/env bash
# One-time bootstrap of the Let's Encrypt certificate for the production stack.
# Run on the server AFTER DNS for $DOMAIN points at this box (on Cloudflare, set the
# record to "DNS only" / grey-cloud for issuance, then you may enable the proxy with
# SSL mode "Full (strict)").
#
#   ./deploy/init-letsencrypt.sh
#
# Reads DOMAIN and CERTBOT_EMAIL from .env. Set STAGING=1 to use Let's Encrypt's staging
# environment while testing (avoids rate limits); rerun without it for the real cert.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

: "${DOMAIN:?set DOMAIN (e.g. timeline.vakahnke.com) in .env}"
: "${CERTBOT_EMAIL:?set CERTBOT_EMAIL in .env}"
STAGING="${STAGING:-0}"

COMPOSE="docker compose -f docker-compose.prod.yml"
cert_path="/etc/letsencrypt/live/$DOMAIN"

echo "### Temporary self-signed cert for $DOMAIN (so nginx can start)…"
$COMPOSE run --rm --entrypoint "\
  sh -c 'mkdir -p $cert_path && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout $cert_path/privkey.pem -out $cert_path/fullchain.pem -subj /CN=localhost'" certbot

echo "### Starting nginx…"
$COMPOSE up -d --build nginx

echo "### Removing the dummy cert and requesting the real one…"
$COMPOSE run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN \
         /etc/letsencrypt/archive/$DOMAIN \
         /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

staging_arg=""
[ "$STAGING" != "0" ] && staging_arg="--staging"

$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot $staging_arg \
    --email $CERTBOT_EMAIL -d $DOMAIN --agree-tos --no-eff-email --force-renewal" certbot

echo "### Reloading nginx with the real certificate…"
$COMPOSE exec nginx nginx -s reload

echo "### Done — https://$DOMAIN should now be live."
