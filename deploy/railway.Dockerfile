# Single-container image for hosted demos (Railway, Fly, Render, any Docker host).
#
# Builds the frontend, then runs Django under gunicorn with WhiteNoise serving both
# the collected static files and the built SPA, so no nginx is needed. Postgres is
# external (DATABASE_URL). Build from the repo root:
#
#   docker build -f deploy/railway.Dockerfile -t timeline-demo .
#
# Required env at runtime: DATABASE_URL, DJANGO_SECRET_KEY, DJANGO_ALLOWED_HOSTS,
# DJANGO_CSRF_TRUSTED_ORIGINS. Optional: SEED_DEMO=1, REQUIRE_ACCOUNT_APPROVAL=0,
# PORT (defaults to 8000), WEB_CONCURRENCY.

# ---- 1. Build the SPA ----
FROM node:25-alpine AS spa
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Baked into the bundle at build time; shows a banner in the app when set.
ARG VITE_DEMO_BANNER=""
ENV VITE_DEMO_BANNER=$VITE_DEMO_BANNER
RUN npm run build

# ---- 2. Backend + SPA ----
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY backend/ .
COPY --from=spa /app/dist /app/spa

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R appuser:appuser /app
USER appuser

ENV SPA_DIST=/app/spa \
    RUN_COLLECTSTATIC=1 \
    DJANGO_DEBUG=0

ENTRYPOINT ["/app/entrypoint.sh"]
EXPOSE 8000
CMD ["gunicorn", "timeline_project.wsgi:application", "-c", "gunicorn.conf.py"]
