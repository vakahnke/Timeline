# Timeline

A multi-user, team-based **project-planning** app built around a fast, designed
Gantt-style timeline. Sign up, create projects, invite teammates with roles, and plan
each project on its own isolated, interactive timeline — with dependency arrows, a
critical path, templates, and reusable teams.

![Timeline](docs/images/timeline.png)

---

## Highlights

- **Interactive timeline** — drag to move events, resize to reschedule, drag across tracks
  to recategorize, smooth cursor-anchored zoom (sub-pixel-per-hour to minute detail), a
  draggable **minimap** for long projects, dependency arrows, and an automatic **critical
  path** (CPM).
- **Multi-tenant & team-based** — every project is isolated; you only ever see projects
  you're a member of. Per-project roles: **owner / editor / viewer**.
- **Templates** — spin up a fully-formed project (categories + timed, dependency-linked
  tasks) anchored to a start date. Built-ins include *Two-Week Sprint*, *Product Launch*,
  *Event Plan*, *Custom Shop Build*, and *MTA Rapid Prototyping (OTA)*. Save any project as
  your own reusable template.
- **Teams** — reusable groups of users; add a whole team to a project at a chosen role in
  one click.
- **JWT auth** with **admin-approved sign-ups** — new accounts stay inactive until you approve
  them in Django admin (you're emailed on each registration; the user is emailed when activated).
  Sign in with **email or username**.
- **Self-documenting API** — Swagger UI, ReDoc, and an OpenAPI schema generated from the code.

## Tech stack

| Layer | Stack |
|------|-------|
| **Backend** | Django 4.2 · Django REST Framework · SimpleJWT · drf-spectacular · drf-nested-routers · PostgreSQL 16 |
| **Frontend** | React 18 · Vite 5 · React Router 6 (plain JSX, no UI framework — small & fast) |
| **Infra** | Docker (dev) · nginx + gunicorn + Postgres (prod) · GitHub Actions CI |

## Documentation

- 📐 [Architecture](docs/ARCHITECTURE.md) — tenancy model, data model, auth flow, frontend design, request flow
- 📖 [User Guide](docs/USER_GUIDE.md) — accounts, projects, the timeline (gestures & shortcuts), templates, teams, roles
- 🚀 [Deployment](docs/DEPLOYMENT.md) — Docker dev & prod, environment variables, nginx/gunicorn, CI
- ☁️ [AWS Deployment](docs/AWS_DEPLOYMENT.md) — EC2 + elastic IP + Cloudflare + HTTPS via Terraform, and instance sizing

## Quick start (development)

Requires Docker. Postgres, the Django API, and the Vite dev server (with hot reload) all
run in containers — one command brings the whole stack up.

```bash
cp .env.example .env          # dev defaults work out of the box
docker compose up --build
```

| Surface | URL |
|---------|-----|
| App (SPA, hot reload) | http://localhost:5173 |
| API | http://localhost:8000/api/ |
| API docs (Swagger) | http://localhost:8000/api/docs/ |
| Django admin | http://localhost:8000/admin/ |

> The dev database is published on host port **5433** (override with `POSTGRES_HOST_PORT`)
> so it won't clash with a local Postgres on 5432.

Seed demo data and an admin (migrations run automatically on backend start):

```bash
docker compose exec backend python manage.py load_sample      # demo project + users
docker compose exec backend python manage.py createsuperuser  # for /admin
```

### Demo accounts

`load_sample` creates a **Demo Project** and three users (password `demo12345`):

| Username | Role on the demo project |
|----------|--------------------------|
| `demo`   | owner  |
| `editor` | editor |
| `viewer` | viewer |

## Using it

A 60-second tour (full details in the [User Guide](docs/USER_GUIDE.md)):

1. **Register** (an admin approves new accounts — you'll be emailed when yours is ready) or
   **log in** with your email or username.
2. **Create a project** — blank, or **From Template** to get a ready-made plan.
3. **Open the timeline.** Drag events to move them, drag edges to resize, drag across tracks
   to recategorize. Zoom with **Ctrl/⌘ + scroll** (or pinch) or the toolbar; **pan** by
   dragging empty space; **Fit** (or press `0`) to frame the whole project. Use the
   **minimap** at the bottom to jump around long projects.
4. **Invite teammates** (owner) via the **Members** panel — by email/username, or add a
   whole **Team** at a role.

**Keyboard:** `+`/`−` zoom · `0` fit · `←`/`→`/`↑`/`↓` pan · `Home`/`End` jump to start/end.

## API

Nested, per-project REST API (JWT in the `Authorization` header). Browse it live at
`/api/docs/` (Swagger) or `/api/redoc/`.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register/` · `/api/auth/token/` · `/api/auth/token/refresh/` · `/api/auth/logout/` | register · log in · refresh · revoke refresh |
| GET | `/api/me/` | current user |
| GET/POST/PATCH/DELETE | `/api/projects/` · `…/<id>/` | your projects |
| GET/POST/PATCH/DELETE | `/api/projects/<id>/members/` · `…/<mid>/` | members (owner-only) |
| GET/POST/PATCH/DELETE | `/api/projects/<id>/events/` · `…/categories/` | viewer reads, editor writes |
| POST | `/api/projects/<id>/events/bulk/` | bulk-create events |
| GET/POST/DELETE | `/api/templates/` · `…/<id>/` | built-in + saved templates |
| POST | `/api/templates/instantiate/` | create a project from a template |
| GET/POST/PATCH/DELETE | `/api/teams/` · `…/<id>/` · `…/members/` | reusable teams |
| POST | `/api/projects/<id>/add-team/` | add a team's members at a role (owner-only) |

## Project structure

```
Timeline/
├── backend/                 # Django + DRF
│   ├── timeline_project/     # settings, root urls, wsgi
│   ├── projects/             # tenancy: Project, Membership, Team, Template, auth, permissions
│   ├── events/               # timeline domain: Category, Event (+ load_sample)
│   ├── Dockerfile · entrypoint.sh · requirements.txt
├── frontend/                # React + Vite SPA
│   └── src/
│       ├── pages/            # LoginPage, RegisterPage, ProjectsDashboard, ProjectTimeline, TeamsPage
│       ├── components/       # Timeline, EventBlock, Minimap, Toolbar, modals (Event/Category/Members/Team/...)
│       ├── auth/ · routes/ · ui/   # AuthContext + token store, ProtectedRoute, ToastProvider
│       └── api.js            # JWT client with single-flight refresh
├── nginx/nginx.conf         # prod reverse proxy + SPA serving
├── docker-compose.yml       # dev stack
├── docker-compose.prod.yml  # prod stack (nginx + gunicorn + postgres)
└── docs/                    # architecture, user guide, deployment
```

## Production

Single-origin, **HTTPS**: nginx terminates TLS (Let's Encrypt via certbot), serves the built
SPA, and reverse-proxies `/api`, `/admin`, `/static`, `/media` to gunicorn — all in Docker.

```bash
cp .env.example .env   # set DJANGO_DEBUG=0, secrets, DOMAIN, CERTBOT_EMAIL, RUN_COLLECTSTATIC=1
./deploy/init-letsencrypt.sh
docker compose -f docker-compose.prod.yml up -d --build
```

- **On AWS** (EC2 + elastic IP + Cloudflare + Terraform) with **instance sizing**, follow
  **[AWS Deployment](docs/AWS_DEPLOYMENT.md)**. Infra lives in [`terraform/`](terraform/).
- General prod details: **[Deployment](docs/DEPLOYMENT.md)**.

## Continuous integration

`.github/workflows/ci.yml` runs, on every push/PR: Django system checks, a
missing-migration check, `migrate` and tests against a Postgres service container, plus a
frontend `npm ci && npm run build`.

## Notes

- `index.html` at the repo root is a **legacy standalone prototype** kept for reference —
  it is not part of the built app (the real frontend lives in `frontend/`).
- This started as a single-user prototype and grew into the multi-tenant app documented here.
