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
| `REQUIRE_ACCOUNT_APPROVAL` | backend | `1` (default): new sign-ups inactive until approved; `0` to disable |
| `TEMPLATE_LIBRARY` | backend | How far a saved template may be shared: `instance` (default; teams or everyone signed in), `teams`, or `off` (templates stay private) |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | backend | Gmail account + App Password. Empty ⇒ console backend (dev) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USE_TLS` | backend | SMTP server (default `smtp.gmail.com` / `587` / on) |
| `DEFAULT_FROM_EMAIL` | backend | `From:` on outgoing email (defaults to `EMAIL_HOST_USER`) |
| `ACCOUNT_NOTIFY_EMAIL` | backend | inbox that receives "new account pending approval" alerts |
| `SITE_URL` | backend | public app URL used in email links (sign-in / admin) |
| `VITE_PROXY_TARGET` | frontend (dev) | `http://backend:8000` |

Generate a production secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

## Production

Single-origin topology with **HTTPS**: the app sits behind Cloudflare's proxy, which terminates
the browser-facing TLS at its edge with a browser-trusted certificate. **nginx** presents a
**Cloudflare Origin Certificate** so the Cloudflare→origin leg is encrypted and validated
(Cloudflare SSL/TLS mode **Full (strict)**), serves the built React bundle, and reverse-proxies
`/api`, `/admin`, `/static`, and `/media` to **gunicorn**. Same origin → no CORS.

`docker-compose.prod.yml` runs db + backend (gunicorn) + nginx (80 + 443). It expects a domain
and an origin certificate. Create the cert in the Cloudflare dashboard (**SSL/TLS → Origin
Server → Create Certificate**) and save the Origin Certificate + Private Key to
`nginx/certs/origin.pem` and `nginx/certs/origin.key` (mounted read-only into the nginx
container; both are gitignored). Then:

```bash
cp .env.example .env
# Edit .env: DJANGO_DEBUG=0, a strong DJANGO_SECRET_KEY + POSTGRES_PASSWORD,
#   DOMAIN=<your domain>, RUN_COLLECTSTATIC=1,
#   DJANGO_ALLOWED_HOSTS=<your domain>, DJANGO_CSRF_TRUSTED_ORIGINS=https://<your domain>
# Place the Cloudflare Origin Certificate at nginx/certs/origin.pem + origin.key
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

- `migrate` + `collectstatic` run automatically on backend start; the Postgres port is **not**
  published. The Cloudflare Origin Certificate is valid for ~15 years, so there's nothing to
  renew. nginx falls back to `index.html` for client-side routing.
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

Cloudflare terminates the browser-facing TLS at its edge (Universal SSL). nginx serves a
**Cloudflare Origin Certificate** on `443` so the Cloudflare→origin leg is encrypted and
validated, with the zone's SSL/TLS mode set to **Full (strict)**. Django honors
`X-Forwarded-Proto` via `SECURE_PROXY_SSL_HEADER`, and prod enables HSTS + secure cookies when
`DJANGO_DEBUG=0`.

## Account approval & email

By default (`REQUIRE_ACCOUNT_APPROVAL=1`) nobody can use the app until **you** approve them:

1. A visitor registers → their account is created **inactive** and they see a "pending
   approval" screen. They cannot obtain a token / sign in.
2. You get an email at **`ACCOUNT_NOTIFY_EMAIL`** with their details and a link to the admin.
3. In **Django admin → Users**, open the account and tick **Active** (the newest sign-ups sort
   to the top), or select them on the list and run **"Approve & notify"**. Either way the
   person is automatically emailed that their account is ready.
4. They sign in with **email or username** + password.

**Email** carries two things: account approval notices and **password reset links** (the
"Forgot your password?" link on the sign-in page). Without working email a reset link is only
written to the backend log, so nobody can recover an account by themselves.

**Email backend** is configured via the `EMAIL_HOST_*` vars. (Django 6.1 replaced its `EMAIL_*`
settings with `MAILERS`; `settings.py` builds that from these same variable names, so an existing
`.env` keeps working.) In dev, with no SMTP credentials
set, it falls back to the console backend (messages print to the backend container logs —
`docker compose logs backend`), so nothing is actually sent. For prod, set the Gmail SMTP
credentials — an **App Password** (not your account password; requires 2-Step Verification):

```bash
EMAIL_HOST_USER=you@gmail.com
EMAIL_HOST_PASSWORD=your-16-char-app-password
ACCOUNT_NOTIFY_EMAIL=you@gmail.com
SITE_URL=https://yourdomain
# EMAIL_HOST/PORT/USE_TLS default to smtp.gmail.com / 587 / on; DEFAULT_FROM_EMAIL
# defaults to EMAIL_HOST_USER. Setting EMAIL_HOST_USER switches on the SMTP backend.
```

> To run an open instance (no approval), set `REQUIRE_ACCOUNT_APPROVAL=0` — registrations become
> active immediately and sign in seamlessly.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR:

- **backend** — spins up a Postgres service container, then `manage.py check`,
  `makemigrations --check`, `migrate`, and `test` (ruff lint is advisory).
- **frontend** — `npm ci` + `npm run build`.

## Keeping it current

- **Requirements:** Python 3.12, Django 6.1, PostgreSQL **15 or newer** (Django 6.1 refuses older).
- **Dependencies:** Dependabot alerts, security updates and secret scanning are enabled on the
  repository and `.github/dependabot.yml` opens grouped update pull requests. Before a release,
  `pip-audit` in the backend image and `npm audit` in the frontend should both be clean.
- **The host:** patch the operating system regularly, not just the containers. A host that has
  been up for months is running an old kernel. Upgrading usually restarts Docker (a short
  outage) and needs a reboot; all three services use `restart: always`, so they return alone.
  Take a disk snapshot first.
- **PostgreSQL minor releases** (16.x → 16.y) share a data format: `docker compose pull db`, then
  `up -d --no-deps db`, with a fresh `pg_dump` beforehand. A **major** upgrade needs dump and restore.
- **Before swapping containers,** try the new images against the real `.env` while the old ones
  still serve: `docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint python
  backend manage.py check --deploy` and `… migrate --plan`, and `… run --rm --no-deps nginx nginx -T`
  (the command must start with `nginx`, or the image skips rendering your config template).
- **Disk:** every deploy leaves the previous images behind. `docker image prune` now and then,
  keeping the last rollback tag.

## Operational notes

- **Apple silicon / arm64:** all base images (`python:3.12-slim`, `postgres:16-alpine`,
  `node:24-alpine`, `nginx:1.30-alpine`) are multi-arch — no emulation needed. Building for
  an amd64 server from a Mac: `--platform linux/amd64` (buildx).
- **Port collisions:** dev publishes `5433` (db), `8000` (api), `5173` (web). Override via
  env or stop the conflicting service.
- **Secrets:** `.env` is gitignored — never commit it. Use strong `DJANGO_SECRET_KEY` and
  `POSTGRES_PASSWORD` in prod; consider Docker secrets / a secrets manager for real deploys.
- **gunicorn** (26.x; its local control socket is switched off in `gunicorn.conf.py`) runs
  `--workers 3 --timeout 60` by default (tune for your box;
  `2 × CPU + 1` is a common starting point).
- **JWT refresh tokens** are revocable: logout (`POST /api/auth/logout/`) blacklists the
  refresh token, and rotation blacklists the one it replaces (`token_blacklist` app). The
  blacklist tables grow over time — prune expired rows periodically:
  ```bash
  docker compose -f docker-compose.prod.yml exec backend python manage.py flushexpiredtokens
  # e.g. weekly cron: 0 4 * * 0  cd /opt/timeline && docker compose -f docker-compose.prod.yml exec -T backend python manage.py flushexpiredtokens
  ```
