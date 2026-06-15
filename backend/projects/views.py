from django.contrib.auth import get_user_model
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Project, ProjectMembership, Role
from .permissions import IsProjectMember, IsProjectOwner, get_role
from .serializers import (
    AddMemberSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    RegisterSerializer,
    UserSerializer,
)

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
        # Queryset-filtering layer: only projects I'm a member of.
        return (Project.objects
                .filter(memberships__user=self.request.user)
                .prefetch_related('memberships__user')
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
