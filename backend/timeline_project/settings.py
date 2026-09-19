from pathlib import Path
from datetime import timedelta

import environ

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
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Timeline API',
    'DESCRIPTION': 'Multi-tenant, team-based project-planning API. '
                   'Authenticate via JWT (POST /api/auth/token/), then send '
                   'Authorization: Bearer <access>. All project data is scoped to '
                   'projects you are a member of.',
    'VERSION': '1.0.0',
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
EMAIL_HOST          = env('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT          = env.int('EMAIL_PORT', default=587)
EMAIL_USE_TLS       = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_HOST_USER     = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_BACKEND = env('EMAIL_BACKEND', default=(
    'django.core.mail.backends.smtp.EmailBackend' if EMAIL_HOST_USER
    else 'django.core.mail.backends.console.EmailBackend'))
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL',
                         default=(EMAIL_HOST_USER or 'Timeline <no-reply@localhost>'))
SERVER_EMAIL = DEFAULT_FROM_EMAIL
# Where "new account pending approval" alerts go (ADMIN_NOTIFY_EMAIL accepted for parity).
ACCOUNT_NOTIFY_EMAIL = env('ACCOUNT_NOTIFY_EMAIL', default=env('ADMIN_NOTIFY_EMAIL', default=''))
# Public app URL used to build links in account emails (sign-in / admin).
SITE_URL = env('SITE_URL', default='http://localhost:5173')
# New registrations stay inactive until an admin approves them. Set to 0 to disable.
REQUIRE_ACCOUNT_APPROVAL = env.bool('REQUIRE_ACCOUNT_APPROVAL', default=True)

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
