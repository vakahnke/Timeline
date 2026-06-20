from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Project, ProjectMembership
from projects.permissions import IsProjectMember

from .models import Category, Event, Task
from .serializers import (
    CategorySerializer,
    EventSerializer,
    MyTaskSerializer,
    TaskSerializer,
)


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


class TaskViewSet(_ProjectScopedMixin, viewsets.ModelViewSet):
    """Tasks nested under an event: /api/projects/<project_pk>/events/<event_pk>/tasks/"""
    serializer_class = TaskSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    @property
    def event(self):
        if not hasattr(self, '_event'):
            self._event = get_object_or_404(
                Event, pk=self.kwargs['event_pk'], project_id=self.kwargs['project_pk'])
        return self._event

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['event'] = self.event
        return ctx

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Task.objects.none()  # no kwargs during schema generation
        return (Task.objects
                .filter(event_id=self.kwargs['event_pk'],
                        event__project_id=self.kwargs['project_pk'])
                .select_related('event', 'owner', 'assignee'))


class ProjectTasksView(generics.ListAPIView):
    """GET /api/projects/<project_pk>/tasks/ — every task in one project (all events,
    all assignees), for the workload manager. Any project member may read."""
    permission_classes = [IsAuthenticated, IsProjectMember]
    serializer_class   = MyTaskSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Task.objects.none()
        return (Task.objects
                .filter(event__project_id=self.kwargs['project_pk'])
                .select_related('event', 'event__project', 'owner', 'assignee')
                .order_by('event__start', 'order', 'id'))


class MyTasksView(generics.ListAPIView):
    """GET /api/me/tasks/ — tasks across all the projects the current user belongs to.
    By default only the user's own assigned tasks; with ?scope=all, every member's tasks
    in those projects (so the dashboard can show the team's workload). Soonest due first."""
    permission_classes = [IsAuthenticated]
    serializer_class   = MyTaskSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Task.objects.none()
        my_projects = ProjectMembership.objects.filter(user=self.request.user).values('project')
        qs = (Task.objects
              .filter(event__project__in=my_projects)
              .select_related('event', 'event__project', 'owner', 'assignee'))
        if self.request.query_params.get('scope') != 'all':
            qs = qs.filter(assignee=self.request.user)
        return qs.order_by('due_date', 'id')
