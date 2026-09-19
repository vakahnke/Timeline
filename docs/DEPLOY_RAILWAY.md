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

`DJANGO_DEBUG`, `RUN_COLLECTSTATIC`, `SPA_DIST`, and `PORT` are already handled
by the image and by Railway.

The reset service uses the same variables plus a custom start command,
`python manage.py reset_demo --yes`, and a cron schedule such as `0 */6 * * *`.

## Setting it up with the CLI

```bash
railway login
railway init                       # new project
railway add --database postgres    # managed Postgres
railway up --service web           # build and deploy from the repo (railway.json picks the Dockerfile)
railway domain                     # get a public URL
```

Then set the variables above on the web service (`railway variables --set KEY=VALUE`),
redeploy, and add the reset service from the dashboard with the cron schedule.

## Cost

A small Django container plus a small Postgres on Railway's Hobby plan runs on
the order of five to ten US dollars a month. Traffic spikes do not change that
much; the instance simply gets slower.

## Abuse

The demo is writable by anyone who signs in. The periodic reset is the main
defence. Do not attach a real mail account to the demo, and do not reuse its
secret key or database anywhere else.
