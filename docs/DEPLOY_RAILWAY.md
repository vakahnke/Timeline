# Hosting a public demo on Railway

This is how the public demo instance is run. The same image works on any host
that can run a Docker container next to a Postgres database (Fly, Render, a VPS).

## How it fits together

One container does everything: `deploy/railway.Dockerfile` builds the frontend,
then runs Django under gunicorn with WhiteNoise serving the API, the admin, the
collected static files, and the built single-page app. Client-side routes fall
back to `index.html` from Django, so no nginx is needed. Postgres is Railway's
managed database, connected through `DATABASE_URL`.

A second Railway service built from the same image runs on a cron schedule and
executes `python manage.py reset_demo --yes`, which wipes every table and
reseeds the sample users and projects. That keeps a public, writable demo from
filling up with junk.

## Environment variables

Set these on the web service:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway reference to the managed database |
| `DJANGO_SECRET_KEY` | a long random string | required in production |
| `DJANGO_ALLOWED_HOSTS` | your service domain, e.g. `timeline-demo.up.railway.app` | Django host check |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://` + the same domain | admin login behind the proxy |
| `SEED_DEMO` | `1` | seed demo users and projects on first start |
| `REQUIRE_ACCOUNT_APPROVAL` | `0` | let visitors register without admin approval |
| `WEB_CONCURRENCY` | `2` | gunicorn workers; 2 fits a small instance |
| `SITE_URL` | `https://` + the domain | links in account emails (none are sent without SMTP) |

| `RAILWAY_DOCKERFILE_PATH` | `deploy/railway.Dockerfile` | makes Railway build from the demo Dockerfile; without it, `railway up` auto-detects the root `index.html` and deploys a static site instead |
| `VITE_DEMO_BANNER` | the notice text | Railway passes service variables as Docker build args, so this is baked into the frontend bundle |

`DJANGO_DEBUG`, `RUN_COLLECTSTATIC`, `SPA_DIST`, and `PORT` are already handled
by the image and by Railway.

The reset service uses the same variables plus a custom start command,
`python manage.py reset_demo --yes`, and a cron schedule such as `0 */6 * * *`.

`reset_demo` deletes every row in the database, so it has two locks: the `--yes` flag and
the environment variable **`ALLOW_DEMO_RESET=1`**. Set that variable on the reset service
and nowhere else. Without it the command refuses to run, which is what protects a real
deployment from a copied cron line or a command run on the wrong host. A production
instance should never set `ALLOW_DEMO_RESET`, `SEED_DEMO`, or `VITE_DEMO_BANNER`.

## Setting it up with the CLI

```bash
railway login
railway init                       # new project
railway add --database postgres    # managed Postgres
railway up --service web           # build and deploy from the repo (railway.json picks the Dockerfile)
railway up --service reset         # the reset service too, from the same tree (see below)
railway domain                     # get a public URL
```

Then set the variables above on the web service (`railway variables --set KEY=VALUE`),
redeploy, and add the reset service from the dashboard with the cron schedule.

**Deploy `web` and `reset` together, every time.** `railway up` deploys one service, so a
change needs two runs, from the same working tree. The reset wipes the database with Django's
`flush`, which truncates the tables *its own code* knows about. If `web` has been deployed with
a migration that adds a table and `reset` has not, Postgres refuses the truncate ("cannot
truncate a table referenced in a foreign key constraint"), the cron run crashes, Railway sends a
"deployment crashed" email every six hours, and the demo is never reset. `reset_demo` now
checks for this before touching anything and says so in its error.

## Cost

A small Django container plus a small Postgres on Railway's Hobby plan runs on
the order of five to ten US dollars a month. Traffic spikes do not change that
much; the instance simply gets slower.

## Abuse

The demo is writable by anyone who signs in. The periodic reset is the main
defence. Do not attach a real mail account to the demo, and do not reuse its
secret key or database anywhere else.
