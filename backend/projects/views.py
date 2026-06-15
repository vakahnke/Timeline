from django.contrib.auth import get_user_model
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Project, ProjectMembership, ProjectTemplate, Role
from .permissions import IsProjectMember, IsProjectOwner, get_role
from .serializers import (
    AddMemberSerializer,
    InstantiateTemplateSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    RegisterSerializer,
    SaveTemplateSerializer,
    TemplateListItemSerializer,
    UserSerializer,
)
from .templates import create_project_from_spec, spec_from_project
from .templates_builtin import BUILTIN_TEMPLATES, builtin_spec

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    """Open self-registration."""
    permission_classes = [AllowAny]
    serializer_class   = RegisterSerializer


class MeView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class   = UserSerializer

    def get_object(self):
        return self.request.user


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Project.objects.none()  # schema generation has no authenticated user
        # Queryset-filtering layer: only projects I'm a member of.
        return (Project.objects
                .filter(memberships__user=self.request.user)
                .prefetch_related('memberships')   # members listed via the dedicated endpoint
                .distinct())

    # Owner-only actions. NOTE: get_permissions overrides any permission_classes set on
    # the @action decorators, so owner-only actions must be enumerated here.
    OWNER_ONLY_ACTIONS = {'destroy', 'members', 'member_detail'}

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

    # ── Member management (Owner only) ──────────────────────────────────────
    @action(detail=True, methods=['get', 'post'], url_path='members')  # owner-only via get_permissions
    def members(self, request, pk=None):
        project = self.get_object()
        if request.method == 'GET':
            qs = project.memberships.select_related('user')
            return Response(ProjectMembershipSerializer(qs, many=True).data)

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


def _builtin_items():
    return [{
        'key': f'builtin:{slug}',
        'source': 'builtin',
        'name': spec['name'],
        'description': spec['description'],
        'category_count': len(spec['categories']),
        'task_count': len(spec['tasks']),
    } for slug, spec in BUILTIN_TEMPLATES.items()]


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
        spec = builtin_spec(key.split(':', 1)[1])
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
        OpenApiParameter('id', OpenApiTypes.INT, OpenApiParameter.PATH),
    ])
    def destroy(self, request, pk=None):
        """Delete one of your saved templates."""
        deleted, _ = ProjectTemplate.objects.filter(pk=pk, owner=request.user).delete()
        if not deleted:
            return Response({'detail': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)
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
