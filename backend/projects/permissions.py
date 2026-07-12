from django.db.models import Q
from rest_framework.permissions import BasePermission, SAFE_METHODS

from .models import ProjectMembership, ProjectTeam, Role

ROLE_RANK = {Role.VIEWER: 1, Role.EDITOR: 2, Role.OWNER: 3}
RANK_ROLE = {rank: role for role, rank in ROLE_RANK.items()}


def is_org_admin(user):
    """Org-admins manage every project. Currently any staff account is an org-admin —
    change this one predicate to move org-admin onto a dedicated flag later."""
    return bool(getattr(user, 'is_authenticated', False) and user.is_staff)


def get_role(user, project_id):
    """Return the user's effective role for the project, or None if no access.

    Access can come from two sources, reconciled by *highest-privilege-wins*:
      1. a direct ProjectMembership, and
      2. any Team assigned to the project (ProjectTeam) that the user is currently on
         (a member or the team's owner) — evaluated LIVE, so team roster changes take
         effect immediately.
    Org-admins (staff) are treated as Owner on every project. See docs/PERMISSIONS.md.
    """
    if not user or not user.is_authenticated or project_id is None:
        return None
    if is_org_admin(user):
        return Role.OWNER

    ranks = []
    membership = (ProjectMembership.objects
                  .filter(user=user, project_id=project_id)
                  .only('role')
                  .first())
    if membership:
        ranks.append(ROLE_RANK[membership.role])
    team_roles = (ProjectTeam.objects
                  .filter(project_id=project_id)
                  .filter(Q(team__members=user) | Q(team__owner=user))
                  .values_list('role', flat=True))
    ranks.extend(ROLE_RANK[r] for r in team_roles)

    return RANK_ROLE[max(ranks)] if ranks else None


class IsProjectMember(BasePermission):
    """
    Nested project resources (events/categories). Project id from URL kwarg 'project_pk'.
    - SAFE methods  -> any member (Viewer+)
    - write methods -> Editor+
    Non-members are denied (and queryset filtering hides their data entirely).
    """
    write_min_role = Role.EDITOR

    def _allows(self, role, method):
        if role is None:
            return False
        if method in SAFE_METHODS:
            return True
        return ROLE_RANK[role] >= ROLE_RANK[self.write_min_role]

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        project_id = view.kwargs.get('project_pk')
        if project_id is None:
            return True  # non-nested route; handled by the view's own queryset/perms
        return self._allows(get_role(request.user, project_id), request.method)

    def has_object_permission(self, request, view, obj):
        return self._allows(get_role(request.user, obj.project_id), request.method)


class IsProjectOwner(BasePermission):
    """Owner-only: member management and project deletion."""

    def _project_id(self, view, obj=None):
        if obj is not None:
            return getattr(obj, 'project_id', None) or getattr(obj, 'id', None)
        return view.kwargs.get('project_pk') or view.kwargs.get('pk')

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        project_id = self._project_id(view)
        if project_id is None:
            return True
        return get_role(request.user, project_id) == Role.OWNER

    def has_object_permission(self, request, view, obj):
        return get_role(request.user, self._project_id(view, obj)) == Role.OWNER


class IsTeamOwnerOrReadOnly(BasePermission):
    """Anyone on a team may read it; only its owner may rename, delete, or change members."""

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return obj.owner_id == request.user.id
