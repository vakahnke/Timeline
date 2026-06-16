# Deployment

Everything runs in Docker. There are two compose files:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | **Dev** — Postgres + Django dev server + Vite (hot reload) |
| `docker-compose.prod.yml` | **Prod** — Postgres + gunicorn + nginx (single origin) |

Both read configuration from a root `.env` (copy it from `.env.example`).

## Development

```bash
cp .env.example .env
docker compose up --build
```

Services:

| Service | Detail | Host port |
|---------|--------|-----------|
| `db` | postgres:16-alpine, named volume `pgdata`, healthcheck | **5433** → 5432 |
| `backend` | `manage.py runserver`, source bind-mounted (autoreload), `RUN_COLLECTSTATIC=0` | 8000 |
| `frontend` | Vite dev server with HMR, proxies `/api` → `http://backend:8000` | 5173 |

- Open the app at **http://localhost:5173**, the API at **http://localhost:8000/api/**.
- The DB host port is **5433** (set `POSTGRES_HOST_PORT` to change it) so it won't clash
  with a local Postgres on 5432. Inside Docker the backend still connects to `db:5432`.
- Migrations run automatically on backend start (the entrypoint waits for Postgres, then
  `migrate`).

### First-run data

```bash
docker compose exec backend python manage.py load_sample      # demo project + demo/editor/viewer
docker compose exec backend python manage.py createsuperuser  # admin login for /admin
```

> The dev database holds real accounts and projects — don't `flush` it. To reset, drop the
> volume: `docker compose down -v` (this deletes all data), then `up` and re-seed.

## Environment variables

Defined in `.env` and injected into the containers.

| Variable | Used by | Notes |
|----------|---------|-------|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | db, backend | database name / role / password |
| `POSTGRES_HOST` / `POSTGRES_PORT` | backend | `db` / `5432` (compose service) |
| `POSTGRES_HOST_PORT` | db (dev) | host-side port for the dev DB (default `5433`) |
| `DATABASE_URL` | backend | e.g. `postgres://timeline:timeline@db:5432/timeline` |
| `DJANGO_SECRET_KEY` | backend | **set a strong value in prod** |
| `DJANGO_DEBUG` | backend | `1` dev / `0` prod |
| `DJANGO_ALLOWED_HOSTS` | backend | comma-separated hostnames |
| `DJANGO_CORS_ALLOWED_ORIGINS` | backend | dev only (Vite origin); empty in same-origin prod |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | backend | prod: your `https://` origin(s) — needed for `/admin` login |
| `DJANGO_SECURE_SSL_REDIRECT` | backend | prod, behind TLS |
| `RUN_COLLECTSTATIC` | backend | `0` dev, `1` prod (entrypoint runs `collectstatic`) |
| `VITE_PROXY_TARGET` | frontend (dev) | `http://backend:8000` |

Generate a production secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

## Production

Single-origin topology with **HTTPS**: **nginx** terminates TLS (Let's Encrypt via the
`certbot` service), serves the built React bundle, and reverse-proxies `/api`, `/admin`,
`/static`, and `/media` to **gunicorn**. Same origin → no CORS.

`docker-compose.prod.yml` runs db + backend (gunicorn) + nginx (80 + 443) + certbot. It
expects a domain and a certificate, so the flow is:

```bash
cp .env.example .env
# Edit .env: DJANGO_DEBUG=0, a strong DJANGO_SECRET_KEY + POSTGRES_PASSWORD,
#   DOMAIN=<your domain>, CERTBOT_EMAIL=<you>, RUN_COLLECTSTATIC=1,
#   DJANGO_ALLOWED_HOSTS=<your domain>, DJANGO_CSRF_TRUSTED_ORIGINS=https://<your domain>
./deploy/init-letsencrypt.sh                          # one-time: obtain the certificate
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

- `migrate` + `collectstatic` run automatically on backend start; the Postgres port is **not**
  published. Cert renewal is automatic (the `certbot` service). nginx falls back to
  `index.html` for client-side routing.
- **`WEB_CONCURRENCY`** in `.env` sets gunicorn worker count (tune to the instance).
- **`/api/health/`** is an unauthenticated health probe for monitoring / load balancers.

Redeploy after changes:

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

> **Full AWS walkthrough** (EC2 + elastic IP + Cloudflare + Terraform + instance sizing):
> see **[AWS Deployment](AWS_DEPLOYMENT.md)**.

### Static & media

- **Django static** (admin + DRF browsable API): `collectstatic` → `static_volume`, served
  by nginx at `/static/` (whitenoise is a fallback under gunicorn).
- **Media** (uploads, if added later): `/media/` from `media_volume`.

### TLS

Terminate TLS in front of nginx (a load balancer, or add a certbot/`443` server block).
Django honors `X-Forwarded-Proto` via `SECURE_PROXY_SSL_HEADER`, and prod enables HSTS +
secure cookies when `DJANGO_DEBUG=0`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR:

- **backend** — spins up a Postgres service container, then `manage.py check`,
  `makemigrations --check`, `migrate`, and `test` (ruff lint is advisory).
- **frontend** — `npm ci` + `npm run build`.

## Operational notes

- **Apple silicon / arm64:** all base images (`python:3.12-slim`, `postgres:16-alpine`,
  `node:20-alpine`, `nginx:1.27-alpine`) are multi-arch — no emulation needed. Building for
  an amd64 server from a Mac: `--platform linux/amd64` (buildx).
- **Port collisions:** dev publishes `5433` (db), `8000` (api), `5173` (web). Override via
  env or stop the conflicting service.
- **Secrets:** `.env` is gitignored — never commit it. Use strong `DJANGO_SECRET_KEY` and
  `POSTGRES_PASSWORD` in prod; consider Docker secrets / a secrets manager for real deploys.
- **gunicorn** runs `--workers 3 --timeout 60` by default (tune for your box;
  `2 × CPU + 1` is a common starting point).
