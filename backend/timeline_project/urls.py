from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse, HttpResponseNotFound
from django.urls import include, path, re_path
from django.views.decorators.cache import never_cache

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('projects.urls')),
]

if settings.SPA_DIST:
    _index = Path(settings.SPA_DIST) / 'index.html'

    @never_cache
    def spa_index(request, path=''):
        """Client-side routes (/, /login, /projects/5, ...) all get the SPA shell."""
        try:
            return HttpResponse(_index.read_bytes(), content_type='text/html; charset=utf-8')
        except FileNotFoundError:
            return HttpResponseNotFound('Frontend build not found.')

    # Everything that is not the API, admin, or a static/asset file.
    urlpatterns.append(re_path(r'^(?!api/|admin/|static/|media/|assets/)(?P<path>.*)$', spa_index))
