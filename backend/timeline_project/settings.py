import sys
from pathlib import Path
from datetime import timedelta

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ['localhost', '127.0.0.1']),
    DJANGO_CORS_ALLOWED_ORIGINS=(list, []),
    DJANGO_CSRF_TRUSTED_ORIGINS=(list, []),
    DJANGO_SECURE_SSL_REDIRECT=(bool, False),
)

# Load a local .env if present (dev). In Docker, real env vars take precedence.
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('DJANGO_SECRET_KEY', default='django-insecure-dev-only-change-me')

DEBUG = env('DJANGO_DEBUG')

ALLOWED_HOSTS = env('DJANGO_ALLOWED_HOSTS')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',  # server-side logout / refresh revocation
    'drf_spectacular',
    'corsheaders',
    # local
    'projects',
    'events',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # must be before CommonMiddleware
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # serve static under gunicorn
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'timeline_project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'timeline_project.wsgi.application'

# ── Database (Postgres via DATABASE_URL) ─────────────────────────────────────
# e.g. postgres://timeline:timeline@db:5432/timeline
DATABASES = {
    'default': env.db(
        'DATABASE_URL',
        default='sqlite:///' + str(BASE_DIR / 'db.sqlite3'),
    ),
}

# Tests create many users; the production hasher is deliberately slow (1.5M rounds in Django 6.1).
# A fast hasher for `manage.py test` only keeps the suite quick. Production is unaffected.
if len(sys.argv) > 1 and sys.argv[1] == 'test':
    PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

# A password-reset link is good for one hour (Django's default is three days).
PASSWORD_RESET_TIMEOUT = 60 * 60

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Optional: serve the built frontend (Vite dist/) from Django itself, so a single
# container can run the whole app without nginx (used by the Railway demo image).
# WhiteNoise serves the files at the site root; urls.py adds the SPA fallback route.
SPA_DIST = env('SPA_DIST', default='')
if SPA_DIST:
    WHITENOISE_ROOT = SPA_DIST
    WHITENOISE_INDEX_FILE = True

STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── CORS ─────────────────────────────────────────────────────────────────────
# Same-origin in prod (nginx) -> empty. Dev (Vite :5173 -> API :8000) -> set via env.
CORS_ALLOWED_ORIGINS = env('DJANGO_CORS_ALLOWED_ORIGINS')
CORS_EXPOSE_HEADERS = ['Content-Disposition']   # lets a cross-origin SPA read a download's filename

# ── Django REST Framework ────────────────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
    ],
    # Password reset (docs/design/password-reset.md) and the template library are throttled.
    # Counters live in the process-local cache, so with N gunicorn workers the effective ceiling
    # is up to N times these numbers: still a firm brake on flooding an inbox or guessing links.
    'DEFAULT_THROTTLE_RATES': {
        'password_reset_request': '5/hour',
        'password_reset_address': '3/hour',
        'password_reset_confirm': '10/hour',
        # The template library: generous for a person, a brake on a script.
        'template_vote':    '120/hour',
        'template_comment': '30/hour',
        'template_report':  '10/hour',
    },
}

# The product's name wherever the server says it: email subjects and sign-offs, the source mark on
# an exported status report, the calendar PRODID,
# the API documentation title. Set APP_NAME to put your own name on your copy.
APP_NAME = env.str('APP_NAME', default='Seedcorn').strip() or 'Seedcorn'

SPECTACULAR_SETTINGS = {
    'TITLE': f'{APP_NAME} API',
    'DESCRIPTION': 'Multi-tenant, team-based project-planning API. '
                   'Authenticate via JWT (POST /api/auth/token/), then send '
                   'Authorization: Bearer <access>. All project data is scoped to '
                   'projects you are a member of.',
    'VERSION': '1.1.0',
    'SERVE_INCLUDE_SCHEMA': False,        # don't expose the raw schema in the UIs
    'SERVE_PERMISSIONS': ['rest_framework.permissions.AllowAny'],
    'SWAGGER_UI_SETTINGS': {'persistAuthorization': True},
    'ENUM_NAME_OVERRIDES': {'RoleEnum': 'projects.models.Role'},
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    # Revoke the old refresh token on every rotation, so a rotated-away (or leaked,
    # then-rotated) token can't be reused. Logout blacklists the current one too.
    'BLACKLIST_AFTER_ROTATION': True,
}

# ── Email & account approval ─────────────────────────────────────────────────
# Gmail SMTP via an app-specific password (myaccount.google.com/apppasswords; the Google
# account needs 2-Step Verification). Set EMAIL_HOST_USER + EMAIL_HOST_PASSWORD in prod and
# real mail is sent automatically; leave them empty in dev and mail prints to the backend
# logs (console backend). These are the SAME variable names as nastran-deck-studio, so the
# same Gmail block can be copied verbatim between the two projects' .env files.
# The environment variable names are unchanged; Django 6.1 replaced the EMAIL_* *settings* with
# MAILERS, and refuses to start if both are defined, so the values are read into locals here.
_email_user = env('EMAIL_HOST_USER', default='')
MAILERS = {
    'default': {
        'BACKEND': env('EMAIL_BACKEND', default=(
            'django.core.mail.backends.smtp.EmailBackend' if _email_user
            else 'django.core.mail.backends.console.EmailBackend')),
    },
}
if MAILERS['default']['BACKEND'].endswith('smtp.EmailBackend'):
    MAILERS['default']['OPTIONS'] = {
        'host': env('EMAIL_HOST', default='smtp.gmail.com'),
        'port': env.int('EMAIL_PORT', default=587),
        'use_tls': env.bool('EMAIL_USE_TLS', default=True),
        'username': _email_user,
        'password': env('EMAIL_HOST_PASSWORD', default=''),
    }
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL',
                         default=(_email_user or f'{APP_NAME} <no-reply@localhost>'))
SERVER_EMAIL = DEFAULT_FROM_EMAIL
# Where "new account pending approval" alerts go (ADMIN_NOTIFY_EMAIL accepted for parity).
ACCOUNT_NOTIFY_EMAIL = env('ACCOUNT_NOTIFY_EMAIL', default=env('ADMIN_NOTIFY_EMAIL', default=''))
# Public app URL used to build links in account emails (sign-in / admin).
SITE_URL = env('SITE_URL', default='http://localhost:5173')
# New registrations stay inactive until an admin approves them. Set to 0 to disable.
REQUIRE_ACCOUNT_APPROVAL = env.bool('REQUIRE_ACCOUNT_APPROVAL', default=True)

# How far a saved template may be shared (docs/design/template-library.md):
#   instance  to chosen teams, or to everyone signed in here (the default)
#   teams     to chosen teams only
#   off       templates stay private to the person who saved them
TEMPLATE_LIBRARY = env.str('TEMPLATE_LIBRARY', default='instance').strip().lower()
# The currency offered first when a project is closed out (docs/design/template-closeout.md).
DEFAULT_CURRENCY = env.str('DEFAULT_CURRENCY', default='USD').strip().upper()[:3]
if TEMPLATE_LIBRARY not in ('instance', 'teams', 'off'):
    raise ImproperlyConfigured("TEMPLATE_LIBRARY must be 'instance', 'teams' or 'off'.")

# ── Security (prod only; behind nginx TLS-terminating proxy) ──────────────────
CSRF_TRUSTED_ORIGINS = env('DJANGO_CSRF_TRUSTED_ORIGINS')

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = env('DJANGO_SECURE_SSL_REDIRECT')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
