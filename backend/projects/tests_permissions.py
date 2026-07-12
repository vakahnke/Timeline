"""Live team-based project access and highest-privilege-wins role reconciliation.

Covers the Phase-1 permissions rework (see docs/PERMISSIONS.md): a Team assigned to a
project grants its current members access, resolved LIVE from team membership — no snapshot.
"""
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Project, ProjectMembership, ProjectTeam, Role, Team

User = get_user_model()

EVENT = {'title': 'E', 'start': '2026-07-01T09:00:00Z', 'end': '2026-07-01T10:00:00Z', 'category': 'Default'}


class TeamProjectAccessTests(APITestCase):
    def setUp(self):
        self.owner    = User.objects.create_user('owner',    'owner@x.com',    'pw')
        self.teammate = User.objects.create_user('mate',     'mate@x.com',     'pw')
        self.newbie   = User.objects.create_user('newbie',   'newbie@x.com',   'pw')
        self.stranger = User.objects.create_user('stranger', 'stranger@x.com', 'pw')

        self.project = Project.objects.create(name='P', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=Role.OWNER)

        self.team = Team.objects.create(name='Squad', owner=self.owner)
        self.team.members.add(self.teammate)

    def proj_url(self):     return f'/api/projects/{self.project.id}/'
    def add_team_url(self): return f'/api/projects/{self.project.id}/add-team/'
    def teams_url(self):    return f'/api/projects/{self.project.id}/teams/'
    def events_url(self):   return f'/api/projects/{self.project.id}/events/'
    def team_link_url(self, team_id): return f'/api/projects/{self.project.id}/teams/{team_id}/'

    def assign(self, role=Role.VIEWER, team=None):
        return ProjectTeam.objects.create(project=self.project, team=team or self.team, role=role)

    # ── visibility, live ──────────────────────────────────────────────────────
    def test_team_member_sees_project_only_after_assignment(self):
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)   # not assigned yet
        self.assign()
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)
        self.assertIn(self.project.id, [p['id'] for p in self.client.get('/api/projects/').data])

    def test_stranger_never_sees_project(self):
        self.assign()
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)

    def test_adding_member_to_team_grants_access_live(self):
        self.assign(Role.VIEWER)
        self.client.force_authenticate(self.newbie)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)
        self.team.members.add(self.newbie)                                    # live, no re-assign
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)

    def test_removing_member_from_team_revokes_access_live(self):
        self.assign(Role.VIEWER)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)
        self.team.members.remove(self.teammate)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)

    def test_direct_grant_survives_team_removal(self):
        self.assign(Role.VIEWER)
        ProjectMembership.objects.create(project=self.project, user=self.teammate, role=Role.VIEWER)
        self.team.members.remove(self.teammate)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)   # keeps direct access

    def test_team_owner_gets_access_even_if_not_a_member(self):
        other = User.objects.create_user('teamowner', 'to@x.com', 'pw')
        t2 = Team.objects.create(name='T2', owner=other)                      # no members
        self.assign(Role.VIEWER, team=t2)
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)

    # ── role reconciliation: highest-privilege-wins ───────────────────────────
    def test_viewer_team_can_read_but_not_write(self):
        self.assign(Role.VIEWER)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.get(self.events_url()).status_code, 200)
        self.assertEqual(self.client.post(self.events_url(), EVENT, format='json').status_code, 403)

    def test_editor_team_can_write(self):
        self.assign(Role.EDITOR)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.post(self.events_url(), EVENT, format='json').status_code, 201)

    def test_highest_privilege_wins_direct_viewer_plus_team_editor(self):
        self.assign(Role.EDITOR)
        ProjectMembership.objects.create(project=self.project, user=self.teammate, role=Role.VIEWER)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.post(self.events_url(), EVENT, format='json').status_code, 201)

    def test_broad_team_grant_never_downgrades_direct_editor(self):
        # direct Editor + team Viewer -> still Editor (can write)
        ProjectMembership.objects.create(project=self.project, user=self.teammate, role=Role.EDITOR)
        self.assign(Role.VIEWER)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.post(self.events_url(), EVENT, format='json').status_code, 201)

    # ── assignment management endpoints ───────────────────────────────────────
    def test_add_team_is_owner_only(self):
        self.client.force_authenticate(self.teammate)
        res = self.client.post(self.add_team_url(), {'team': self.team.id, 'role': 'viewer'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_add_team_rejects_owner_role(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(self.add_team_url(), {'team': self.team.id, 'role': 'owner'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_add_team_upserts_idempotently(self):
        self.client.force_authenticate(self.owner)
        r1 = self.client.post(self.add_team_url(), {'team': self.team.id, 'role': 'viewer'}, format='json')
        r2 = self.client.post(self.add_team_url(), {'team': self.team.id, 'role': 'editor'}, format='json')
        self.assertEqual((r1.status_code, r2.status_code), (201, 200))
        links = ProjectTeam.objects.filter(project=self.project, team=self.team)
        self.assertEqual(links.count(), 1)
        self.assertEqual(links.first().role, 'editor')

    def test_add_team_only_your_own_team(self):
        others_team = Team.objects.create(name='Nope', owner=self.stranger)
        self.client.force_authenticate(self.owner)
        res = self.client.post(self.add_team_url(), {'team': others_team.id, 'role': 'viewer'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_members_can_list_assigned_teams(self):
        self.assign(Role.EDITOR)
        self.client.force_authenticate(self.teammate)
        res = self.client.get(self.teams_url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data[0]['team']['name'], 'Squad')
        self.assertEqual(res.data[0]['role'], 'editor')

    def test_remove_team_is_owner_only_and_revokes_access(self):
        self.assign(Role.VIEWER)
        # a non-owner cannot remove
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.delete(self.team_link_url(self.team.id)).status_code, 403)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)   # still has access
        # owner removes -> access revoked
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(self.team_link_url(self.team.id)).status_code, 204)
        self.client.force_authenticate(self.teammate)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)

    def test_remove_unassigned_team_404s(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(self.team_link_url(self.team.id)).status_code, 404)


# Render the admin page against plain static storage — the prod WhiteNoise manifest storage
# needs a collectstatic manifest that doesn't exist under the test runner.
@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class EffectiveAccessAdminTests(APITestCase):
    """The read-only Effective Access admin report page (org-admins only)."""

    def setUp(self):
        self.url = reverse('admin:projects_effectiveaccessreport_changelist')
        self.staff = User.objects.create_user('boss', 'boss@x.com', 'pw', is_staff=True)
        self.plain = User.objects.create_user('plebe', 'plebe@x.com', 'pw')
        p = Project.objects.create(name='Alpha', owner=self.plain)
        ProjectMembership.objects.create(project=p, user=self.plain, role=Role.OWNER)
        team = Team.objects.create(name='Crew', owner=self.plain)
        team.members.add(self.staff)
        ProjectTeam.objects.create(project=p, team=team, role=Role.EDITOR)

    def test_renders_for_staff(self):
        self.client.force_login(self.staff)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'Effective access')
        self.assertContains(res, 'Alpha')          # the project appears
        self.assertContains(res, 'via team')        # provenance rendered

    def test_forbidden_for_non_staff(self):
        self.client.force_login(self.plain)
        res = self.client.get(self.url)
        self.assertIn(res.status_code, (302, 403))  # admin bounces non-staff


class UserDirectoryTests(APITestCase):
    """The /api/users/ directory that powers the member/team pickers."""

    def setUp(self):
        self.alice = User.objects.create_user('alice', 'alice@x.com', 'pw')
        User.objects.create_user('bob', 'bob@x.com', 'pw')
        User.objects.create_user('ghost', 'ghost@x.com', 'pw', is_active=False)  # unapproved

    def test_requires_auth(self):
        self.assertIn(self.client.get('/api/users/').status_code, (401, 403))

    def test_lists_active_users_only(self):
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/users/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual({u['username'] for u in res.data}, {'alice', 'bob'})  # ghost excluded

    def test_search_by_username_or_email(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual([u['username'] for u in self.client.get('/api/users/?search=bob').data], ['bob'])
        self.assertEqual({u['username'] for u in self.client.get('/api/users/?search=x.com').data},
                         {'alice', 'bob'})
