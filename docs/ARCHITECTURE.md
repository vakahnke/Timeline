# Architecture

Timeline is a decoupled **React single-page app** talking to a **Django REST Framework** API over
JWT, backed by **PostgreSQL**. In production one nginx origin serves the built app and
reverse-proxies the API.

```
Browser ── React SPA (Vite build) ──┐
                                     │  /api  (Authorization: Bearer <JWT>)
                                     ▼
                      nginx ──► gunicorn ──► Django + DRF ──► PostgreSQL
                      (prod)     (/api, /admin, /static, /media)
```

In **dev**, the Vite dev server (`:5173`) proxies `/api` to the Django dev server (`:8000`). In
**prod** everything is one origin behind nginx, so there is no CORS. The public demo uses a third
shape: a single container where gunicorn serves the API and WhiteNoise serves the built app
(`deploy/railway.Dockerfile`, see [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md)).

| Layer | Versions |
|---|---|
| Backend | Python 3.12, Django 6.1, Django REST Framework 3.18, SimpleJWT, drf-spectacular, gunicorn 26 |
| Database | PostgreSQL 15 or newer (16 in the compose files) |
| Frontend | React 19, Vite 8, React Router 7, @dnd-kit for the board. Plain JSX and CSS, no UI kit |
| Build / serve | Node 24 to build, nginx 1.30 to serve in prod |

## Tenancy model

Everything belongs to exactly one project. There is no global data.

```
User ──< ProjectMembership(role) >── Project ──< Category
  │                                     │  └───< Event ──< Task
  └──< Team.members                     │            └───< Comment
        Team ──< ProjectTeam(role) >────┤
                                        ├──< StatusReport
                                        └──< Baseline
```

Isolation is enforced in **two** places, never one:

1. **Queryset filtering.** `get_queryset()` only returns rows of projects the caller can reach, so
   other projects are invisible: a list is empty, a detail is a 404.
2. **A DRF permission class** that re-checks the caller's role for the action.

### Data model (`backend/projects/models.py`, `backend/events/models.py`)

| Model | Key fields |
|-------|-----------|
| `Project` | `name`, `description`, `owner`, `committed_end` (the date the project is held to), `status_thresholds` (JSON limits for the status rule) |
| `ProjectMembership` | `user`, `project`, `role` — unique per (user, project) |
| `Team` | `owner`, `name`, `description`, `members` (M2M to users) |
| `ProjectTeam` | `project`, `team`, `role`, `added_by` — a **live** grant of project access to a team |
| `Category` | `project`, `name`, `color` — unique per (project, name). A category is a **track** on the timeline |
| `Event` | `project`, `title`, `start`, `end`, `category` (string), `color`, `notes`, `percent_complete`, `is_milestone`, `depends_on` (self M2M) |
| `Task` | `event`, `title`, `status` (todo / in progress / blocked / done), `owner`, `assignee`, `due_date`, `order` |
| `Comment` | `event`, `author`, `body` |
| `StatusReport` | `project`, `author`, `as_of`, `layout`, `status` + `status_source` + `override_reason` + `rule_fired`, `content` (JSON page document), `snapshot` (JSON frozen facts) |
| `Baseline` | `project`, `name`, `created_by`, `committed_end`, `planned_start/end`, `events` (JSON: each event's dates when frozen), `active` |
| `ProjectTemplate` | `owner`, `name`, `description`, `categories` (JSON), `tasks` (JSON) |
| `HiddenBuiltinTemplate` | lets an org-admin hide a built-in template |

`Event.category` is a **free-text string**, not a foreign key. The frontend groups events into
tracks by that name; the `project` foreign key is the security boundary, so a label is enough and
keeps the wire format simple.

Dependencies are **finish-to-start only, with no lag**. The API refuses loops
(`EventSerializer._reject_cycle`) and links to another project's events.

## Authentication

JWT via `djangorestframework-simplejwt`: a 30-minute access token and a 7-day refresh token that
rotates, with the old one blacklisted on every rotation and on sign-out.

- `POST /api/auth/register/` — self-registration. New accounts wait for operator approval unless
  `REQUIRE_ACCOUNT_APPROVAL=0`.
- `POST /api/auth/token/` — sign in with a **username or an email** (`backend/projects/auth.py`).
- `POST /api/auth/token/refresh/`, `POST /api/auth/logout/`, `GET /api/me/`.
- `POST /api/auth/password-reset/` and `…/confirm/` — reset by email
  (`backend/projects/password_reset.py`, design in [design/password-reset.md](design/password-reset.md)).
  Identical answers for known and unknown addresses, one-hour single-use links from Django's
  signed token generator, every other session signed out, throttled per caller and per address.

Tokens carry **identity only**, never permissions.

**Frontend** (`frontend/src/auth/`, `frontend/src/api.js`): `tokenStore.js` keeps tokens in
`localStorage`; `AuthContext` restores the session on load; `api.js` attaches the bearer token, and
on a `401` refreshes **once** (single-flight, so concurrent calls share one refresh) and retries.
`api.js` also handles file downloads (`{ blob: true }` returns the bytes and the server's filename).

Because the API is JWT-in-header, not cookies, CSRF does not gate `/api`. Django's session and
CSRF protection still guard `/admin`.

## Permissions (`backend/projects/permissions.py`)

One rule: **can this caller do this action on this project?** The token says who the caller is;
`get_role(user, project_id)` then loads their **current** access from the database. Nothing the
client sends (a role in a body, a header, a token claim) is a source of authority. The full
statement and what it covers is at the top of [PERMISSIONS.md](PERMISSIONS.md), and
`backend/projects/tests_authority.py` attacks it.

Roles: `viewer < commenter < editor < owner`.

| Action | Needs |
|---|---|
| Read anything in a project, download exports, print or export a status report | any member |
| Post a comment | commenter or higher |
| Create or edit events, tracks, tasks, saved reports, baselines, project details and limits | editor or higher |
| Manage members and teams, delete the project | owner |

Access has two sources, and the highest wins: a direct `ProjectMembership`, or a `Team` assigned
through `ProjectTeam`. Team access is **live**: it follows the team's current roster, and a team can
grant Editor at most. Staff accounts (`is_staff`) are org-admins and count as Owner everywhere.
The people directory (`/api/users/`) lists only the people you share a project or team with, plus
exact-match lookup for inviting someone new (`backend/projects/directory.py`).

## API routing (`backend/projects/urls.py`)

Routes are **nested per project** with `drf-nested-routers`, so the project id is always in the
path and can never be a forgotten or forged parameter:

```
/api/projects/                                   list, create
/api/projects/<id>/                              read, update, delete
/api/projects/<id>/members/   …/members/<mid>/   …/access/
/api/projects/<id>/teams/     …/teams/<tid>/     …/add-team/
/api/projects/<id>/categories/
/api/projects/<id>/events/    …/events/bulk/
/api/projects/<id>/events/<eid>/tasks/
/api/projects/<id>/events/<eid>/comments/
/api/projects/<id>/tasks/                        every task in the project (workload view)
/api/projects/<id>/status-reports/    …/draft/   …/export-pptx/
/api/projects/<id>/baselines/
/api/projects/<id>/calendar.ics
/api/projects/<id>/export/msproject.xml
/api/me/   /api/me/tasks/   /api/users/
/api/templates/   /api/templates/instantiate/
/api/teams/       /api/teams/<id>/members/
/api/health/
```

The OpenAPI schema is generated by `drf-spectacular` and served at `/api/schema/`, `/api/docs/`
(Swagger) and `/api/redoc/`.

## Scheduling math (`backend/events/schedule.py`)

`critical_path(events)` is a forward and backward pass over the dependency graph that returns each
event's float and the set of critical events. The timeline computes the same thing in the browser
for interaction speed; the status report and the exports use the server's.

## Status report

Design and as-built notes: [design/status-one-pager.md](design/status-one-pager.md).

- **One versioned facts endpoint**, `GET …/status-reports/draft/`
  (`backend/events/status_report.py`): dates, duration-weighted progress, variance against the
  commitment, milestones, one simplified row per track, blocked and overdue work, slip against the
  active baseline, what moved since the previous report, and a history for trend charts. `suggest()`
  derives the status by rule (first match wins) and drafts the headline. Fields are only ever
  added; a change of meaning bumps `facts.version`.
- **The page is a document owned by the frontend** (`components/report/reportModel.js`), saved as
  `StatusReport.content` JSON, so a project can shape its page without a migration. `snapshot`
  freezes the facts, which makes a saved report reproducible.
- **Three renderers from one payload:** the editable page (`StatusPage.jsx`, SVG timeline), print
  and PDF through a print stylesheet, and a native PowerPoint file built with `python-pptx`
  (`backend/events/pptx_export.py`): text boxes, grouped shapes, a real table, no pictures.
- **Anything about how much the plan changed is opt-in per report**: baselines, slip, "what moved"
  and the trend chart all start switched off.

## Exports

Read-only, open to every member, built by pure functions that take a project and its events:

- **iCalendar** (`ical_export.py`, the `icalendar` library): stable UIDs, UTC times, entries marked
  free, dependencies as `RELATED-TO`. Design: [design/icalendar-export.md](design/icalendar-export.md).
- **Microsoft Project XML** (`msproject_export.py`, standard library): tracks as summary tasks,
  events as manually scheduled tasks on a 24-hour calendar so dates open unchanged. The format is
  an ordered sequence; the element order is pinned by a test. Design:
  [design/ms-project-xml.md](design/ms-project-xml.md).

## Templates

A template is `{categories, tasks}` where each task stores **relative** timing
(`start_offset_minutes`, `duration_minutes`) and `depends_on` as task indices. Built-in templates
live in code (`backend/projects/templates_builtin.py`); saved templates store the same shape in a
`ProjectTemplate` row, so instantiation treats both identically. On **instantiate**, tasks are
shifted so the first lands on the chosen start date and dependencies are re-wired. The project can
be created for yourself or for someone you already work with.

A template is the **plan**, not the record of one run (`spec_from_project`). Saving a project keeps
tracks, events, durations, dependencies, notes, key-milestone flags and each event's to-do list
(titles, with due dates as day offsets). It drops dates, progress, to-do status and assignees, and
the project's members. A new project always starts at zero percent, including from templates saved
before that rule existed. `backend/projects/tests_template_reuse.py` holds this through the API.

## Email

`backend/projects/emails.py` sends account notices and password-reset mail through Django's
`MAILERS` setting, built in `settings.py` from the `EMAIL_*` environment variables: SMTP when
`EMAIL_HOST_USER` is set, otherwise the console. Every send is wrapped so a mail failure never
breaks the request that triggered it.

## Frontend architecture

- **Shell** (`App.jsx`): `AuthProvider`, `ToastProvider`, router. Public routes: `/login`,
  `/register`, `/forgot-password`, `/reset-password`. Behind `ProtectedRoute`: `/` (dashboard),
  `/teams`, `/projects/:id` and `/projects/:id/status`, the last two lazy-loaded.
- **`ProjectTimeline`** loads a project's events and tracks, derives `canEdit` from the caller's
  role (a courtesy; the server decides), owns undo and redo, and hosts three views of the same
  data: **Timeline**, **List** (`EventList`) and **Board** (`Board`, tasks by status, @dnd-kit).
- **`Timeline`** is the performance-critical part. Event blocks are DOM elements, but everything
  that used to be many sticky layers or per-scroll SVG is drawn on **viewport-sized canvases** that
  are repainted imperatively on scroll: the ruler, the lane backgrounds and the dependency arrows.
  That is what keeps Safari smooth.
  - The critical path is memoized on the events only, never on zoom.
  - Zoom eases toward its target in one `requestAnimationFrame` loop and re-anchors in
    `useLayoutEffect`, before paint, so it glides instead of snapping.
  - The canvases and the minimap watch their **container** with a `ResizeObserver`, not just the
    window's resize event, so rotating a phone, opening the header rail or the on-screen keyboard
    redraws them at the right size.
  - Canvas backing stores are scaled by the device pixel ratio (capped at 2) with the CSS size
    pinned, or a high-density screen clips them.
- **Input:** a plain drag pans and Ctrl/⌘-drag moves an event, so nothing moves by accident. On
  touch the equivalent is press-and-hold to pick an event up, with grab dots to resize, and a
  two-finger pinch to zoom (`EventBlock.jsx`; design in [design/touch-timeline.md](design/touch-timeline.md)).
- **`Minimap`** draws the whole project to a canvas with a draggable viewport box.
- **Phones:** one compact layout for narrow or short screens (`useIsNarrow`, the header rail, the
  `(max-height: 500px)` landscape rules in `style.css`).

## Request flow (example)

`Editor drags an event` →
`PATCH /api/projects/42/events/7/ {start, end, category}` →
JWT identifies the caller → `IsProjectMember` loads their current role for project 42 (editor or
higher for a write) → `EventViewSet` queryset scoped to project 42 → `EventSerializer` validates
`end > start`, that `depends_on` stays inside the project, and that no loop is created → the row
is updated → the optimistic UI is confirmed.

## Tests

`python manage.py test` runs about 200 backend tests in a few seconds (a fast password hasher is
used for test runs only). CI (`.github/workflows/ci.yml`) also runs Django's system checks, the
missing-migration check and the frontend production build.
