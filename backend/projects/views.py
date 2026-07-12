from django.contrib.auth import get_user_model
from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .emails import notify_admin_new_registration
from .models import HiddenBuiltinTemplate, Project, ProjectMembership, ProjectTeam, ProjectTemplate, Role, Team
from .permissions import IsProjectMember, IsProjectOwner, IsTeamOwnerOrReadOnly, get_role, is_org_admin
from .serializers import (
    AddMemberSerializer,
    AddTeamToProjectSerializer,
    IdentifierSerializer,
    InstantiateTemplateSerializer,
    LogoutSerializer,
    MeSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    ProjectTeamSerializer,
    RegisterSerializer,
    SaveTemplateSerializer,
    TeamSerializer,
    TemplateListItemSerializer,
    UserSerializer,
)
from .templates import create_project_from_spec, spec_from_project
from .templates_builtin import BUILTIN_TEMPLATES, builtin_spec

User = get_user_model()


def _resolve_user(identifier):
    identifier = (identifier or '').strip()
    if not identifier:
        return None
    return (User.objects.filter(email__iexact=identifier).first()
            or User.objects.filter(username__iexact=identifier).first())


class RegisterView(generics.CreateAPIView):
    """Open self-registration. New accounts are inactive until an admin approves them."""
    permission_classes = [AllowAny]
    serializer_class   = RegisterSerializer

    def perform_create(self, serializer):
        user = serializer.save()
        if not user.is_active:                  # approval required -> tell the operator
            notify_admin_new_registration(user)


class MeView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class   = MeSerializer

    def get_object(self):
        return self.request.user


class UserListView(generics.ListAPIView):
    """A directory of active users, for populating the member / team-member pickers so
    people don't have to memorize usernames. Any authenticated user may read it (members
    already see each other's names in member lists and task pickers). Optional ?search=
    filters by username or email (case-insensitive substring). Inactive (unapproved)
    accounts are excluded so you can't add someone who can't log in."""
    permission_classes = [IsAuthenticated]
    serializer_class   = UserSerializer

    def get_queryset(self):
        qs = User.objects.filter(is_active=True).order_by('username')
        q = (self.request.query_params.get('search') or '').strip()
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q))
        return qs


class LogoutView(generics.GenericAPIView):
    """Server-side logout: blacklist a refresh token so it can't be used again.

    Takes just the refresh token (the access token may already be expired), so it needs
    no authentication. Idempotent — an already-invalid/expired token returns 200 too.
    """
    permission_classes     = [AllowAny]
    authentication_classes = []
    serializer_class       = LogoutSerializer

    @extend_schema(responses={200: None})
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data['refresh']).blacklist()
        except TokenError:
            pass  # malformed/expired/already-blacklisted — nothing left to revoke
        return Response({'detail': 'Logged out.'}, status=status.HTTP_200_OK)


class HealthView(APIView):
    """Unauthenticated liveness/readiness probe (for monitoring / a load balancer)."""
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={200: None, 503: None})
    def get(self, request):
        try:
            connection.ensure_connection()
            db_ok = True
        except Exception:
            db_ok = False
        return Response(
            {'status': 'ok' if db_ok else 'degraded', 'database': db_ok},
            status=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Project.objects.none()  # schema generation has no authenticated user
        qs = (Project.objects
              .annotate(
                  ev_start=Min('events__start'),
                  ev_end=Max('events__end'),
                  avg_progress=Avg('events__percent_complete'),
                  ev_count=Count('events'),
              )
              .prefetch_related('memberships'))   # members listed via the dedicated endpoint
        if is_org_admin(self.request.user):
            return qs                              # org-admins manage every project
        # Two access sources, via subqueries (not joins) so the event aggregates above aren't
        # multiplied: a direct membership, or a Team assigned to the project that the user is
        # currently on. Team access is live — resolved from current membership.
        user = self.request.user
        my_ids   = ProjectMembership.objects.filter(user=user).values('project')
        team_ids = (ProjectTeam.objects
                    .filter(Q(team__members=user) | Q(team__owner=user))
                    .values('project'))
        return qs.filter(Q(id__in=my_ids) | Q(id__in=team_ids)).distinct()

    # Owner-only actions. NOTE: get_permissions overrides any permission_classes set on
    # the @action decorators, so owner-only actions must be enumerated here.
    OWNER_ONLY_ACTIONS = {'destroy', 'member_detail', 'add_team', 'team_detail'}

    def get_permissions(self):
        # Writes to events/categories are handled by their own viewsets; project metadata
        # edits (update/partial_update) require >= Editor (enforced in update()).
        if self.action in self.OWNER_ONLY_ACTIONS:
            return [IsAuthenticated(), IsProjectOwner()]
        return [IsAuthenticated()]

    def _require_editor(self, request):
        role = get_role(request.user, self.kwargs.get('pk'))
        return role in (Role.OWNER, Role.EDITOR)

    def update(self, request, *args, **kwargs):
        if not self._require_editor(request):
            return Response({'detail': 'Editor role required.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        project = serializer.save(owner=self.request.user)
        ProjectMembership.objects.create(
            project=project, user=self.request.user, role=Role.OWNER,
        )

    # ── Member management ───────────────────────────────────────────────────
    # GET: any project member (needed to populate task owner/assignee pickers).
    # POST (add member): owner only — enforced inline below.
    @action(detail=True, methods=['get', 'post'], url_path='members')
    def members(self, request, pk=None):
        project = self.get_object()  # get_queryset is membership-scoped -> non-members 404
        if request.method == 'GET':
            qs = project.memberships.select_related('user')
            return Response(ProjectMembershipSerializer(qs, many=True).data)

        if get_role(request.user, project.id) != Role.OWNER:
            return Response({'detail': 'Owner role required.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = AddMemberSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        target = serializer.context['target_user']
        role   = serializer.validated_data['role']
        membership, created = ProjectMembership.objects.get_or_create(
            project=project, user=target, defaults={'role': role},
        )
        if not created:
            membership.role = role
            membership.save(update_fields=['role'])
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(ProjectMembershipSerializer(membership).data, status=code)

    @extend_schema(parameters=[
        OpenApiParameter('membership_pk', OpenApiTypes.INT, OpenApiParameter.PATH),
    ])
    @action(detail=True, methods=['patch', 'delete'],
            url_path=r'members/(?P<membership_pk>[^/.]+)')  # owner-only via get_permissions
    def member_detail(self, request, pk=None, membership_pk=None):
        project = self.get_object()
        try:
            membership = project.memberships.get(pk=membership_pk)
        except ProjectMembership.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=status.HTTP_404_NOT_FOUND)

        owner_count = project.memberships.filter(role=Role.OWNER).count()

        if request.method == 'DELETE':
            if membership.role == Role.OWNER and owner_count == 1:
                return Response({'detail': 'Cannot remove the last owner.'},
                                status=status.HTTP_400_BAD_REQUEST)
            membership.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH role
        new_role = request.data.get('role')
        if new_role not in dict(Role.choices):
            return Response({'detail': 'Invalid role.'}, status=status.HTTP_400_BAD_REQUEST)
        if membership.role == Role.OWNER and new_role != Role.OWNER and owner_count == 1:
            return Response({'detail': 'Cannot demote the last owner.'},
                            status=status.HTTP_400_BAD_REQUEST)
        membership.role = new_role
        membership.save(update_fields=['role'])
        return Response(ProjectMembershipSerializer(membership).data)

    @extend_schema(request=AddTeamToProjectSerializer, responses=ProjectTeamSerializer)
    @action(detail=True, methods=['post'], url_path='add-team')  # owner-only via get_permissions
    def add_team(self, request, pk=None):
        """Assign one of your teams to this project at a role (Viewer or Editor). LIVE: every
        current and future member of the team gets at least that access — no snapshot."""
        project = self.get_object()
        serializer = AddTeamToProjectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        team = Team.objects.filter(pk=serializer.validated_data['team'], owner=request.user).first()
        if not team:
            return Response({'team': 'Team not found.'}, status=status.HTTP_400_BAD_REQUEST)
        link, created = ProjectTeam.objects.update_or_create(
            project=project, team=team,
            defaults={'role': serializer.validated_data['role'], 'added_by': request.user},
        )
        return Response(
            ProjectTeamSerializer(link, context={'request': request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    # GET: any member sees which teams are assigned. DELETE (team_detail): owner-only.
    @extend_schema(responses=ProjectTeamSerializer(many=True))
    @action(detail=True, methods=['get'], url_path='teams')
    def teams(self, request, pk=None):
        project = self.get_object()  # get_queryset is access-scoped -> non-members 404
        links = (project.team_links
                 .select_related('team', 'team__owner')
                 .prefetch_related('team__members'))
        return Response(ProjectTeamSerializer(links, many=True, context={'request': request}).data)

    @extend_schema(parameters=[OpenApiParameter('team_id', OpenApiTypes.INT, OpenApiParameter.PATH)])
    @action(detail=True, methods=['delete'],
            url_path=r'teams/(?P<team_id>[^/.]+)')  # owner-only via get_permissions
    def team_detail(self, request, pk=None, team_id=None):
        """Un-assign a team from this project; its members lose team-derived access at once."""
        project = self.get_object()
        deleted, _ = ProjectTeam.objects.filter(project=project, team_id=team_id).delete()
        if not deleted:
            return Response({'detail': 'Team assignment not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _hidden_builtin_slugs():
    return set(HiddenBuiltinTemplate.objects.values_list('slug', flat=True))


def _builtin_items():
    hidden = _hidden_builtin_slugs()
    return [{
        'key': f'builtin:{slug}',
        'source': 'builtin',
        'name': spec['name'],
        'description': spec['description'],
        'category_count': len(spec['categories']),
        'task_count': len(spec['tasks']),
    } for slug, spec in BUILTIN_TEMPLATES.items() if slug not in hidden]


def _saved_items(user):
    return [{
        'key': f'saved:{tpl.id}',
        'source': 'saved',
        'id': tpl.id,
        'name': tpl.name,
        'description': tpl.description,
        'category_count': len(tpl.categories or []),
        'task_count': len(tpl.tasks or []),
    } for tpl in ProjectTemplate.objects.filter(owner=user)]


def _resolve_template(key, user):
    """Return (spec, default_name, default_description) for a template key, or None."""
    if key.startswith('builtin:'):
        slug = key.split(':', 1)[1]
        if slug in _hidden_builtin_slugs():     # retired by an admin -> no longer usable
            return None
        spec = builtin_spec(slug)
        return (spec, spec['name'], spec['description']) if spec else None
    if key.startswith('saved:'):
        try:
            tpl = ProjectTemplate.objects.get(pk=int(key.split(':', 1)[1]), owner=user)
        except (ProjectTemplate.DoesNotExist, ValueError):
            return None
        return ({'categories': tpl.categories, 'tasks': tpl.tasks}, tpl.name, tpl.description)
    return None


class TemplateViewSet(viewsets.ViewSet):
    """Built-in + user-saved project templates, and instantiation."""
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=TemplateListItemSerializer(many=True))
    def list(self, request):
        return Response(_builtin_items() + _saved_items(request.user))

    @extend_schema(request=SaveTemplateSerializer, responses=TemplateListItemSerializer)
    def create(self, request):
        """Save an existing project (that you're a member of) as a reusable template."""
        serializer = SaveTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if get_role(request.user, data['project']) is None:
            return Response({'detail': 'You are not a member of that project.'},
                            status=status.HTTP_403_FORBIDDEN)
        project = Project.objects.get(pk=data['project'])
        spec = spec_from_project(project)
        tpl = ProjectTemplate.objects.create(
            owner=request.user, name=data['name'], description=data.get('description', ''),
            categories=spec['categories'], tasks=spec['tasks'],
        )
        return Response({
            'key': f'saved:{tpl.id}', 'source': 'saved', 'id': tpl.id,
            'name': tpl.name, 'description': tpl.description,
            'category_count': len(tpl.categories), 'task_count': len(tpl.tasks),
        }, status=status.HTTP_201_CREATED)

    @extend_schema(responses=None, parameters=[
        OpenApiParameter('id', OpenApiTypes.STR, OpenApiParameter.PATH,
                         description='Saved template id (numeric), or built-in slug (admins only).'),
    ])
    def destroy(self, request, pk=None):
        """Delete a template. A numeric `pk` deletes one of your own saved templates; a
        built-in slug retires that built-in globally (admins only)."""
        try:
            saved_pk = int(pk)
        except (TypeError, ValueError):
            return self._retire_builtin(request, pk)

        deleted, _ = ProjectTemplate.objects.filter(pk=saved_pk, owner=request.user).delete()
        if not deleted:
            return Response({'detail': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _retire_builtin(self, request, slug):
        """Hide a built-in template for everyone. Restricted to admin (staff) accounts."""
        if not request.user.is_staff:
            return Response({'detail': 'Only admins can delete built-in templates.'},
                            status=status.HTTP_403_FORBIDDEN)
        if slug not in BUILTIN_TEMPLATES:
            return Response({'detail': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)
        HiddenBuiltinTemplate.objects.get_or_create(
            slug=slug, defaults={'hidden_by': request.user})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=InstantiateTemplateSerializer, responses=ProjectSerializer)
    @action(detail=False, methods=['post'])
    def instantiate(self, request):
        """Create a project from a template, anchored to a start date, for a chosen owner."""
        serializer = InstantiateTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        resolved = _resolve_template(data['key'], request.user)
        if resolved is None:
            return Response({'detail': 'Unknown template.'}, status=status.HTTP_400_BAD_REQUEST)
        spec, default_name, default_description = resolved

        identifier = (data.get('owner') or '').strip()
        if identifier:
            target = (User.objects.filter(email__iexact=identifier).first()
                      or User.objects.filter(username__iexact=identifier).first())
            if not target:
                return Response({'owner': 'No user found with that email or username.'},
                                status=status.HTTP_400_BAD_REQUEST)
        else:
            target = request.user

        project = create_project_from_spec(
            spec,
            name=(data.get('name') or default_name),
            description=(data.get('description') or default_description),
            start=data['start'],
            owner=target,
            also_owner=request.user,
        )
        return Response(
            ProjectSerializer(project, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class TeamViewSet(viewsets.ModelViewSet):
    """Reusable groups of people. Visible to the owner and to every member; only the owner
    may rename it, delete it, or change its membership."""
    serializer_class   = TeamSerializer
    permission_classes = [IsAuthenticated, IsTeamOwnerOrReadOnly]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Team.objects.none()
        user = self.request.user
        return (Team.objects
                .filter(Q(owner=user) | Q(members=user))
                .distinct()
                .prefetch_related('members'))

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @extend_schema(request=IdentifierSerializer, responses=TeamSerializer)
    @action(detail=True, methods=['post'], url_path='members')
    def add_member(self, request, pk=None):
        """Add a user (by email or username) to this team."""
        team = self.get_object()
        user = _resolve_user(request.data.get('identifier'))
        if not user:
            return Response({'identifier': 'No user found with that email or username.'},
                            status=status.HTTP_400_BAD_REQUEST)
        team.members.add(user)
        return Response(self.get_serializer(team).data)

    @extend_schema(responses=TeamSerializer, parameters=[
        OpenApiParameter('user_id', OpenApiTypes.INT, OpenApiParameter.PATH),
    ])
    @action(detail=True, methods=['delete'], url_path=r'members/(?P<user_id>[^/.]+)')
    def remove_member(self, request, pk=None, user_id=None):
        """Remove a user from this team."""
        team = self.get_object()
        team.members.remove(user_id)
        return Response(self.get_serializer(team).data)
