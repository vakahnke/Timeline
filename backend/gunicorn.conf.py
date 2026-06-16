import os

# Network
bind = '0.0.0.0:8000'

# Workers — driven by WEB_CONCURRENCY (set per instance size; rule of thumb 2*vCPU+1,
# but it's memory-bound: each sync worker is a full Django process ~120 MB).
workers = int(os.environ.get('WEB_CONCURRENCY', '3'))
worker_class = 'sync'
timeout = int(os.environ.get('GUNICORN_TIMEOUT', '60'))

# Recycle workers periodically to bound memory growth.
max_requests = 1000
max_requests_jitter = 100

# Log to stdout/stderr so Docker captures it.
accesslog = '-'
errorlog = '-'
