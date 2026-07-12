"""Shared effective-access computation for the admin report page and the
`audit_permissions` management command.

Everything runs through permissions.get_role, so the report always matches what the app
actually enforces: org-admin override → team grants → direct grants, highest-privilege-wins.
See docs/PERMISSIONS.md.
"""
from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Project, ProjectMembership, ProjectTeam
from .permissions import get_role, is_org_admin

User = get_user_model()

# get_role returns a Role member (a str subclass); normalize to a plain 'owner'/'editor'/'viewer'.
def _rv(role):
    return getattr(role, 'value', role)


def _sources(user, project, is_admin):
    """Human-readable list of *why* the user has access to the project."""
    if is_admin:
        return ['org-admin (owner on every project)']
    out = []
    m = ProjectMembership.objects.filter(user=user, project=project).only('role').first()
    if m:
        out.append(f'{_rv(m.role)} — direct')
    for link in (ProjectTeam.objects.filter(project=project)
                 .filter(Q(team__members=user) | Q(team__owner=user)).select_related('team')):
        out.append(f'{_rv(link.role)} — via team "{link.team.name}"')
    return out


def build_report():
    """Return (rows, no_access).

    rows: one dict per (user, project) the user can reach, sorted by username then project,
          with the effective role, view/edit/manage capabilities, and provenance.
    no_access: registered users who can't reach any project.
    """
    users = list(User.objects.order_by('username'))
    projects = list(Project.objects.order_by('name'))
    rows = []
    for u in users:
        admin = is_org_admin(u)
        for p in projects:
            role = _rv(get_role(u, p.id))
            if not role:
                continue
            rows.append({
                'user': u.username,
                'email': u.email,
                'project': p.name,
                'project_id': p.id,
                'role': role,
                'can_view': True,
                'can_edit': role in ('owner', 'editor'),
                'can_manage': role == 'owner',
                'sources': _sources(u, p, admin),
                'is_admin': admin,
            })
    accessed = {r['user'] for r in rows}
    no_access = [{'user': u.username, 'email': u.email}
                 for u in users if u.username not in accessed]
    return rows, no_access


def project_access(project):
    """Effective access for ONE project: every user who can reach it, with provenance.

    Effective role comes from get_role (so it matches enforcement); the direct-grant and
    per-team details are for display and management in the Members panel. One dict per user:
      {user, role, direct_role, membership_id, via_teams: [{team_id,name,role}], is_org_admin}
    """
    users = list(User.objects.order_by('username'))
    direct = {m.user_id: m for m in
              ProjectMembership.objects.filter(project=project).select_related('user')}
    links = list(ProjectTeam.objects.filter(project=project).select_related('team'))
    # Users each team grants to (members + the team's owner), gathered once.
    link_user_ids = {}
    for link in links:
        ids = set(link.team.members.values_list('id', flat=True))
        ids.add(link.team.owner_id)
        link_user_ids[link.id] = ids

    rows = []
    for u in users:
        role = _rv(get_role(u, project.id))
        if not role:
            continue
        m = direct.get(u.id)
        via = [{'team_id': link.team_id, 'name': link.team.name, 'role': _rv(link.role)}
               for link in links if u.id in link_user_ids[link.id]]
        rows.append({
            'user': {'id': u.id, 'username': u.username, 'email': u.email},
            'role': role,
            'direct_role': _rv(m.role) if m else None,
            'membership_id': m.id if m else None,
            'via_teams': via,
            'is_org_admin': is_org_admin(u),
        })
    order = {'owner': 0, 'editor': 1, 'viewer': 2}
    rows.sort(key=lambda r: (order.get(r['role'], 9), r['user']['username']))
    return rows
