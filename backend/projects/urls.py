from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from events.views import CategoryViewSet, EventViewSet

from .views import MeView, ProjectViewSet, RegisterView

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')

projects_nested = NestedDefaultRouter(router, r'projects', lookup='project')
projects_nested.register(r'events',     EventViewSet,    basename='project-events')
projects_nested.register(r'categories', CategoryViewSet, basename='project-categories')

urlpatterns = [
    path('auth/register/',      RegisterView.as_view(),        name='register'),
    path('auth/token/',         TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', TokenRefreshView.as_view(),    name='token_refresh'),
    path('me/',                 MeView.as_view(),              name='me'),
    path('', include(router.urls)),
    path('', include(projects_nested.urls)),
]
