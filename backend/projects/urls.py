from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from events.views import CategoryViewSet, EventViewSet

from .views import MeView, ProjectViewSet, RegisterView, TeamViewSet, TemplateViewSet

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'templates', TemplateViewSet, basename='template')
router.register(r'teams', TeamViewSet, basename='team')

projects_nested = NestedDefaultRouter(router, r'projects', lookup='project')
projects_nested.register(r'events',     EventViewSet,    basename='project-events')
projects_nested.register(r'categories', CategoryViewSet, basename='project-categories')

urlpatterns = [
    path('auth/register/',      RegisterView.as_view(),        name='register'),
    path('auth/token/',         TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', TokenRefreshView.as_view(),    name='token_refresh'),
    path('me/',                 MeView.as_view(),              name='me'),

    # API documentation (OpenAPI schema + Swagger UI + ReDoc).
    path('schema/', SpectacularAPIView.as_view(), name='schema'),
    path('docs/',   SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('redoc/',  SpectacularRedocView.as_view(url_name='schema'),   name='redoc'),

    path('', include(router.urls)),
    path('', include(projects_nested.urls)),
]
