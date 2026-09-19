from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from events.views import (CategoryViewSet, CommentViewSet, EventViewSet, MyTasksView,
                          ProjectTasksView, StatusReportViewSet, TaskViewSet)

from .auth import EmailOrUsernameTokenObtainPairView
from .views import (
    HealthView,
    LogoutView,
    MeView,
    ProjectViewSet,
    RegisterView,
    TeamViewSet,
    TemplateViewSet,
    UserListView,
)

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'templates', TemplateViewSet, basename='template')
router.register(r'teams', TeamViewSet, basename='team')

projects_nested = NestedDefaultRouter(router, r'projects', lookup='project')
projects_nested.register(r'events',     EventViewSet,    basename='project-events')
projects_nested.register(r'categories', CategoryViewSet, basename='project-categories')
projects_nested.register(r'status-reports', StatusReportViewSet, basename='project-status-reports')

events_nested = NestedDefaultRouter(projects_nested, r'events', lookup='event')
events_nested.register(r'tasks',    TaskViewSet,    basename='event-tasks')
events_nested.register(r'comments', CommentViewSet, basename='event-comments')

urlpatterns = [
    path('auth/register/',      RegisterView.as_view(),                       name='register'),
    path('auth/token/',         EmailOrUsernameTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', TokenRefreshView.as_view(),                   name='token_refresh'),
    path('auth/logout/',        LogoutView.as_view(),                         name='logout'),
    path('me/',                 MeView.as_view(),              name='me'),
    path('users/',              UserListView.as_view(),        name='users'),
    path('me/tasks/',           MyTasksView.as_view(),         name='my-tasks'),
    path('projects/<int:project_pk>/tasks/', ProjectTasksView.as_view(), name='project-tasks'),
    path('health/',             HealthView.as_view(),          name='health'),

    # API documentation (OpenAPI schema + Swagger UI + ReDoc).
    path('schema/', SpectacularAPIView.as_view(), name='schema'),
    path('docs/',   SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('redoc/',  SpectacularRedocView.as_view(url_name='schema'),   name='redoc'),

    path('', include(router.urls)),
    path('', include(projects_nested.urls)),
    path('', include(events_nested.urls)),
]
