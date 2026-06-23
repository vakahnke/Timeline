"""Org-admins (staff) manage every project: implicit Owner on all of them, while a
non-staff non-member still sees and touches nothing. Runs against the test database."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from events.models import Event, Task

from .models import Project, ProjectMembership, Role

User = get_user_model()


class OrgAdminTests(APITestCase):
    def setUp(self):
        # admin is staff but deliberately NOT a member of the project.
        self.admin    = User.objects.create_user('admin',    'admin@x.com',    'pw', is_staff=True)
        self.owner    = User.objects.create_user('owner',    'owner@x.com',    'pw')
        self.stranger = User.objects.create_user('stranger', 'stranger@x.com', 'pw')

        self.project = Project.objects.create(name='Secret', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=Role.OWNER)
        now = timezone.now()
        self.event = Event.objects.create(
            project=self.project, title='E', start=now, end=now + timedelta(hours=1))

    def proj_url(self):    return f'/api/projects/{self.project.id}/'
    def members_url(self): return f'/api/projects/{self.project.id}/members/'
    def events_url(self):  return f'/api/projects/{self.project.id}/events/'
    def tasks_url(self):   return f'/api/projects/{self.project.id}/events/{self.event.id}/tasks/'

    # ── Org-admin powers ──────────────────────────────────────────────────────
    def test_admin_lists_foreign_projects_as_owner(self):
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api/projects/')
        self.assertEqual(res.status_code, 200)
        row = next((x for x in res.data if x['id'] == self.project.id), None)
        self.assertIsNotNone(row, 'org-admin should see a project they are not a member of')
        self.assertEqual(row['my_role'], 'owner')   # -> full controls in the UI

    def test_admin_can_update_foreign_project(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 200)
        res = self.client.patch(self.proj_url(), {'name': 'Renamed'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.project.refresh_from_db()
        self.assertEqual(self.project.name, 'Renamed')

    def test_admin_can_delete_foreign_project(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(self.proj_url()).status_code, 204)
        self.assertFalse(Project.objects.filter(id=self.project.id).exists())

    def test_admin_can_manage_members(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(self.members_url(), {'identifier': 'stranger', 'role': 'viewer'}, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.stranger).exists())

    def test_admin_can_write_events_and_tasks(self):
        self.client.force_authenticate(self.admin)
        now = timezone.now()
        ev = self.client.post(self.events_url(),
                              {'title': 'New', 'start': now.isoformat(),
                               'end': (now + timedelta(hours=2)).isoformat()}, format='json')
        self.assertEqual(ev.status_code, 201, ev.data)
        tk = self.client.post(self.tasks_url(), {'title': 'Do it'}, format='json')
        self.assertEqual(tk.status_code, 201, tk.data)
        self.assertEqual(tk.data['owner']['username'], 'admin')   # creator is the admin

    # ── Regression: a non-staff non-member still has zero access ──────────────
    def test_stranger_cannot_see_or_touch_foreign_project(self):
        self.client.force_authenticate(self.stranger)
        ids = [x['id'] for x in self.client.get('/api/projects/').data]
        self.assertNotIn(self.project.id, ids)
        self.assertEqual(self.client.get(self.proj_url()).status_code, 404)
        # destroy is owner-gated at has_permission (by URL pk), so a non-owner is denied
        # before object lookup -> 403; either way the project must survive.
        self.assertIn(self.client.delete(self.proj_url()).status_code, (403, 404))
        self.assertTrue(Project.objects.filter(id=self.project.id).exists())
        now = timezone.now()
        ev = self.client.post(self.events_url(),
                              {'title': 'X', 'start': now.isoformat(),
                               'end': (now + timedelta(hours=1)).isoformat()}, format='json')
        self.assertIn(ev.status_code, (403, 404))
        self.assertFalse(Event.objects.filter(title='X').exists())
