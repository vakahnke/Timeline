"""Who a user is allowed to see in the people directory.

The directory exists so pickers can suggest names. It must not be a list of everyone with an
account: on an instance with open registration that hands every visitor every other visitor's
email address. So a user sees the people they already work with, and can look up anyone else only
by typing that person's exact username or email (which is how you invite someone new).
"""
from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Project, ProjectMembership, ProjectTeam, Team
from .permissions import is_org_admin

User = get_user_model()


def known_users(user):
    """Active users who share a project or a team with ``user`` (and ``user``). Org-admins, who
    manage every project, see everyone."""
    active = User.objects.filter(is_active=True)
    if is_org_admin(user):
        return active
    my_teams = Team.objects.filter(Q(members=user) | Q(owner=user))
    my_projects = Project.objects.filter(
        Q(id__in=ProjectMembership.objects.filter(user=user).values('project'))
        | Q(id__in=ProjectTeam.objects.filter(team__in=my_teams).values('project')))
    teams_on_my_projects = Team.objects.filter(id__in=ProjectTeam.objects.filter(project__in=my_projects).values('team'))
    teams = Team.objects.filter(Q(id__in=my_teams.values('id')) | Q(id__in=teams_on_my_projects.values('id')))
    return active.filter(
        Q(id=user.id)
        | Q(id__in=ProjectMembership.objects.filter(project__in=my_projects).values('user'))
        | Q(id__in=teams.values('owner'))
        | Q(id__in=teams.values('members'))
    ).distinct()


def is_known(user, other):
    return known_users(user).filter(id=other.id).exists()
