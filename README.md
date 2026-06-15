# Timeline — Team Project Planning

A multi-user, team-based project-management app built around a fast, designed
Gantt-style timeline. Sign up, create projects, invite teammates with roles, and
plan each project on its own isolated timeline.

- **Backend:** Django + DRF, JWT auth (`djangorestframework-simplejwt`), PostgreSQL.
- **Frontend:** React 18 + Vite SPA, React Router, project-scoped timeline UI.
- **Infra:** Docker for dev; nginx + gunicorn + Postgres for production.

## Architecture

- **Tenancy:** `User → ProjectMembership(role) → Project`. Every `Category` and
  `Event` belongs to a project. Access is enforced in both the queryset and a DRF
  permission class — a user only ever sees projects they're a member of.
- **Roles:** `owner` (manage members, delete project, full edit), `editor`
  (create/edit events & categories), `viewer` (read-only).
- **Routes:** nested per project — `/api/projects/<id>/{events,categories,members}/`.

## Development (one command)

Requires Docker. Postgres, the Django API, and the Vite dev server (with HMR) all
run in containers.

```bash
cp .env.example .env          # dev defaults work out of the box
docker compose up --build
```

- SPA (dev):  http://localhost:5173
- API:        http://localhost:8000/api/
- Admin:      http://localhost:8000/admin/

> The dev DB is published on host port **5433** (override with `POSTGRES_HOST_PORT`)
> to avoid clashing with a local Postgres on 5432.

First-run extras (migrations run automatically on backend start):

```bash
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py load_sample      # demo project + users
```

`load_sample` seeds a **Demo Project** and three users (password `demo12345`):

| Username | Role   |
|----------|--------|
| `demo`   | owner  |
| `editor` | editor |
| `viewer` | viewer |

## API quick reference

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register/` | open self-registration |
| POST | `/api/auth/token/` | obtain access + refresh |
| POST | `/api/auth/token/refresh/` | refresh access token |
| GET  | `/api/me/` | current user |
| GET/POST | `/api/projects/` | your projects / create one |
| GET/POST | `/api/projects/<id>/members/` | owner-only |
| GET/POST | `/api/projects/<id>/events/` | viewer reads, editor writes |
| GET/POST | `/api/projects/<id>/categories/` | viewer reads, editor writes |

## Production

```bash
cp .env.example .env
# EDIT .env: set DJANGO_DEBUG=0, a real DJANGO_SECRET_KEY, a strong POSTGRES_PASSWORD,
# real DJANGO_ALLOWED_HOSTS, and DJANGO_CSRF_TRUSTED_ORIGINS for your https domain.
docker compose -f docker-compose.prod.yml up --build -d
```

- App on http://localhost (nginx :80). `migrate` + `collectstatic` run automatically
  on backend start.
- nginx serves the built SPA and reverse-proxies `/api`, `/admin`, `/static`, `/media`
  to gunicorn (single origin — no CORS needed in production).

Create an admin and redeploy frontend changes:

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
docker compose -f docker-compose.prod.yml build nginx && \
  docker compose -f docker-compose.prod.yml up -d nginx
```

## Notes

- `index.html` at the repo root is a legacy standalone prototype, kept for reference —
  it is **not** part of the built app (the real frontend lives in `frontend/`).
- CI (`.github/workflows/ci.yml`) runs Django checks, a missing-migration check,
  migrations, and tests against a Postgres service container, plus a frontend build.
