from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from projects.models import Project, ProjectMembership, Role
from projects.permissions import IsAnyProjectMember, IsProjectCommenter, IsProjectMember, get_role

from .models import Category, Comment, Event, StatusReport, Task
from .serializers import (
    CategorySerializer,
    CommentSerializer,
    EventSerializer,
    MyTaskSerializer,
    StatusReportExportSerializer,
    StatusReportListSerializer,
    StatusReportSerializer,
    TaskSerializer,
)
from .pptx_export import build_pptx
from .status_report import build_facts, suggest


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
              .annotate(
                  task_count=Count('tasks', distinct=True),
                  tasks_done=Count('tasks', filter=Q(tasks__status='done'), distinct=True),
              )
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


class CommentViewSet(_ProjectScopedMixin, viewsets.ModelViewSet):
    """Comments on an event: /api/projects/<project_pk>/events/<event_pk>/comments/

    Read: any member (Viewer+). Post: Commenter+ (what the Commenter role unlocks).
    Edit/delete: the comment's author, or the project owner (moderation).
    """
    serializer_class   = CommentSerializer
    permission_classes = [IsAuthenticated, IsProjectCommenter]
    http_method_names  = ['get', 'post', 'patch', 'delete', 'head', 'options']

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
            return Comment.objects.none()
        return (Comment.objects
                .filter(event_id=self.kwargs['event_pk'],
                        event__project_id=self.kwargs['project_pk'])
                .select_related('author', 'event'))

    def _can_modify(self, comment):
        return (comment.author_id == self.request.user.id
                or get_role(self.request.user, self.kwargs['project_pk']) == Role.OWNER)

    def update(self, request, *args, **kwargs):
        if not self._can_modify(self.get_object()):
            return Response({'detail': 'Only the author or an owner can edit this comment.'},
                            status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._can_modify(self.get_object()):
            return Response({'detail': 'Only the author or an owner can delete this comment.'},
                            status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


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


class StatusReportViewSet(_ProjectScopedMixin, viewsets.ModelViewSet):
    """Saved status reports: /api/projects/<project_pk>/status-reports/

    Read: any member. Create/edit/delete: Editor+ (IsProjectMember). ``draft/`` returns the live
    facts, the rule-derived status and headline, and the previous report to start from.
    """
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_serializer_class(self):
        return StatusReportListSerializer if self.action == 'list' else StatusReportSerializer

    def get_permissions(self):
        # Exporting changes nothing, so it is open to every member even though it is a POST.
        if self.action == 'export_pptx':
            return [IsAuthenticated(), IsAnyProjectMember()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return StatusReport.objects.none()
        return (StatusReport.objects.filter(project_id=self.kwargs['project_pk'])
                .select_related('author'))

    @extend_schema(
        summary='Live status facts for a project',
        description=(
            'Everything a status page can be filled in from, computed from the live schedule: '
            '`facts` (versioned; dates, duration-weighted progress, time elapsed, variance against the '
            'committed finish, milestones, one simplified timeline row per track with critical-path '
            'spans, blocked/overdue task counts, what finished since the previous report and what is '
            'due next), `suggestion` (the rule-derived status, the rule that fired, a drafted headline), '
            'and `previous` (the last saved report, whose shape a new one starts from). '
            'This is the single source for the print tool and for any export or script; consumers '
            'must ignore fields they do not know.'),
        responses=OpenApiTypes.OBJECT,
    )
    @action(detail=False, methods=['get'], url_path='draft')
    def draft(self, request, project_pk=None):
        previous = self.get_queryset().first()
        facts = build_facts(self.project, since=previous.as_of if previous else None)
        return Response({
            'facts': facts,
            'suggestion': suggest(facts),
            'previous': StatusReportSerializer(previous, context=self.get_serializer_context()).data if previous else None,
        })

    @extend_schema(
        summary='Export the status report as a native PowerPoint file',
        description=(
            'Returns a .pptx built from exactly what the print tool holds: the report document '
            '(`content`), the status fields, and the facts it was drawn from (`snapshot`), so the '
            'file matches the page on screen whether or not it has been saved. Every element is a '
            'native, editable PowerPoint object (text boxes, shapes, a table); nothing is an image. '
            'Open to every project member.'),
        request=StatusReportExportSerializer,
        responses={(200, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'): OpenApiTypes.BINARY},
    )
    @action(detail=False, methods=['post'], url_path='export-pptx')
    def export_pptx(self, request, project_pk=None):
        ser = StatusReportExportSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        data = build_pptx(
            doc=d['content'], facts=d['snapshot'], layout=d['layout'], paper=d['paper'], previous=d['previous'],
            tz_offset_minutes=d['tz_offset'],
            report={'status': d['status'], 'status_source': d['status_source'],
                    'override_reason': d['override_reason'], 'rule_fired': d['rule_fired']},
        )
        name = f"{slugify(self.project.name) or 'project'}-status-{str(d['snapshot'].get('as_of', ''))[:10]}.pptx"
        resp = HttpResponse(data, content_type='application/vnd.openxmlformats-officedocument.presentationml.presentation')
        resp['Content-Disposition'] = f'attachment; filename="{name}"'
        resp['Content-Length'] = str(len(data))
        return resp
