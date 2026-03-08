from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, EventViewSet

router = DefaultRouter()
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'events', EventViewSet, basename='event')

urlpatterns = [
    path('', include(router.urls)),
]
