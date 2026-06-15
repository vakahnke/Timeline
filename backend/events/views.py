from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Project
from projects.permissions import IsProjectMember

from .models import Category, Event
from .serializers import CategorySerializer, EventSerializer


class _ProjectScopedMixin:
    """Scopes a viewset to /api/projects/<project_pk>/... and injects the project."""
    permission_classes = [IsAuthenticated, IsProjectMember]

    @property
    def project(self):
        if not hasattr(self, '_project'):
            self._project = Project.objects.get(pk=self.kwargs['project_pk'])
        return self._project

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['project'] = self.project
        return ctx


class CategoryViewSet(_ProjectScopedMixin, viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Category.objects.none()  # no project_pk during schema generation
        return Category.objects.filter(project_id=self.kwargs['project_pk'])


class EventViewSet(_ProjectScopedMixin, viewsets.ModelViewSet):
    serializer_class = EventSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Event.objects.none()  # no project_pk during schema generation
        qs = (Event.objects
              .filter(project_id=self.kwargs['project_pk'])
              .prefetch_related('depends_on'))
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk_create(self, request, project_pk=None):
        """POST /api/projects/<project_pk>/events/bulk/ — create multiple events at once."""
        if not isinstance(request.data, list):
            return Response({'detail': 'Expected a list.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EventSerializer(data=request.data, many=True,
                                     context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
