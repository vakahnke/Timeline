"""Tasks inside events: ownership/assignment defaults, role-based access, and the
per-user 'my tasks' dashboard feed. Runs against the isolated test database."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from projects.models import Project, ProjectMembership, Role

from .models import Event, Task

User = get_user_model()


class TaskTestBase(APITestCase):
    def setUp(self):
        self.owner  = User.objects.create_user('owner',  'owner@example.com',  'pw')
        self.editor = User.objects.create_user('editor', 'editor@example.com', 'pw')
        self.viewer = User.objects.create_user('viewer', 'viewer@example.com', 'pw')
        self.outsider = User.objects.create_user('outsider', 'outsider@example.com', 'pw')

        self.project = Project.objects.create(name='P', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner,  role=Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.editor, role=Role.EDITOR)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=Role.VIEWER)

        now = timezone.now()
        self.event = Event.objects.create(
            project=self.project, title='E', start=now, end=now + timedelta(hours=1))

    def tasks_url(self, event=None):
        ev = event or self.event
        return f'/api/projects/{self.project.id}/events/{ev.id}/tasks/'


class TaskCrudTests(TaskTestBase):
    def test_owner_defaults_to_creator_and_assignee_defaults_to_owner(self):
        self.client.force_authenticate(self.editor)
        res = self.client.post(self.tasks_url(), {'title': 'Do it'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['owner']['username'], 'editor')      # creator
        self.assertEqual(res.data['assignee']['username'], 'editor')   # defaults to owner
        self.assertEqual(res.data['status'], 'todo')

    def test_explicit_owner_and_assignee_by_identifier(self):
        self.client.force_authenticate(self.editor)
        res = self.client.post(self.tasks_url(), {
            'title': 'Assigned work',
            'owner_identifier': 'owner',
            'assignee_identifier': 'viewer@example.com',  # email also resolves
            'due_date': '2026-07-01',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['owner']['username'], 'owner')
        self.assertEqual(res.data['assignee']['username'], 'viewer')
        self.assertEqual(res.data['due_date'], '2026-07-01')

    def test_assignee_defaults_to_explicit_owner_when_blank(self):
        self.client.force_authenticate(self.editor)
        res = self.client.post(self.tasks_url(),
                               {'title': 'X', 'owner_identifier': 'owner'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['assignee']['username'], 'owner')

    def test_unknown_identifier_is_rejected(self):
        self.client.force_authenticate(self.editor)
        res = self.client.post(self.tasks_url(),
                               {'title': 'X', 'owner_identifier': 'ghost'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('owner_identifier', res.data)

    def test_viewer_can_read_but_not_create(self):
        Task.objects.create(event=self.event, title='T', owner=self.owner, assignee=self.owner)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(self.tasks_url()).status_code, 200)
        res = self.client.post(self.tasks_url(), {'title': 'nope'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_outsider_cannot_access_tasks(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.tasks_url()).status_code, 403)

    def test_patch_status_and_delete(self):
        t = Task.objects.create(event=self.event, title='T', owner=self.owner, assignee=self.owner)
        self.client.force_authenticate(self.editor)
        res = self.client.patch(f'{self.tasks_url()}{t.id}/', {'status': 'done'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'done')
        self.assertEqual(self.client.delete(f'{self.tasks_url()}{t.id}/').status_code, 204)
        self.assertFalse(Task.objects.filter(id=t.id).exists())


class MyTasksFeedTests(TaskTestBase):
    def test_returns_only_my_tasks_sorted_by_due_date_with_context(self):
        # A task assigned to viewer, in this project, with a due date.
        Task.objects.create(event=self.event, title='Later', owner=self.owner,
                            assignee=self.viewer, due_date='2026-08-01')
        Task.objects.create(event=self.event, title='Sooner', owner=self.owner,
                            assignee=self.viewer, due_date='2026-07-01')
        # Assigned to someone else -> must not appear.
        Task.objects.create(event=self.event, title='Editors', owner=self.owner,
                            assignee=self.editor)

        # A task in a project the viewer is NOT a member of -> must not appear.
        other = Project.objects.create(name='Other', owner=self.outsider)
        now = timezone.now()
        other_event = Event.objects.create(project=other, title='OE', start=now, end=now + timedelta(hours=1))
        Task.objects.create(event=other_event, title='Hidden', owner=self.outsider, assignee=self.viewer)

        self.client.force_authenticate(self.viewer)
        res = self.client.get('/api/me/tasks/')
        self.assertEqual(res.status_code, 200)
        titles = [t['title'] for t in res.data]
        self.assertEqual(titles, ['Sooner', 'Later'])  # due-date order, others excluded
        self.assertEqual(res.data[0]['project']['name'], 'P')
        self.assertEqual(res.data[0]['event']['title'], 'E')

    def test_requires_authentication(self):
        self.assertEqual(self.client.get('/api/me/tasks/').status_code, 401)


class TaskEdgeCaseTests(TaskTestBase):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.event2 = Event.objects.create(
            project=self.project, title='E2', start=now, end=now + timedelta(hours=1))

    def test_update_assignee_by_identifier_leaves_owner(self):
        t = Task.objects.create(event=self.event, title='T', owner=self.owner, assignee=self.owner)
        self.client.force_authenticate(self.editor)
        res = self.client.patch(f'{self.tasks_url()}{t.id}/',
                                {'assignee_identifier': 'viewer'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['assignee']['username'], 'viewer')
        self.assertEqual(res.data['owner']['username'], 'owner')  # owner untouched

    def test_clear_due_date(self):
        t = Task.objects.create(event=self.event, title='T', owner=self.owner,
                                assignee=self.owner, due_date='2026-07-01')
        self.client.force_authenticate(self.editor)
        res = self.client.patch(f'{self.tasks_url()}{t.id}/', {'due_date': None}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIsNone(res.data['due_date'])

    def test_viewer_cannot_patch_or_delete(self):
        t = Task.objects.create(event=self.event, title='T', owner=self.owner, assignee=self.owner)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.patch(f'{self.tasks_url()}{t.id}/',
                                           {'status': 'done'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'{self.tasks_url()}{t.id}/').status_code, 403)

    def test_task_list_is_scoped_to_its_event(self):
        Task.objects.create(event=self.event,  title='in-ev1', owner=self.owner, assignee=self.owner)
        Task.objects.create(event=self.event2, title='in-ev2', owner=self.owner, assignee=self.owner)
        self.client.force_authenticate(self.editor)
        res = self.client.get(self.tasks_url(self.event2))
        self.assertEqual(res.status_code, 200)
        self.assertEqual([t['title'] for t in res.data], ['in-ev2'])

    def test_tasks_ordered_by_order_field(self):
        Task.objects.create(event=self.event, title='second', owner=self.owner, assignee=self.owner, order=2)
        Task.objects.create(event=self.event, title='first',  owner=self.owner, assignee=self.owner, order=1)
        self.client.force_authenticate(self.viewer)
        res = self.client.get(self.tasks_url())
        self.assertEqual([t['title'] for t in res.data], ['first', 'second'])

    def test_create_under_event_from_another_project_is_404(self):
        other = Project.objects.create(name='Other', owner=self.outsider)
        now = timezone.now()
        foreign = Event.objects.create(project=other, title='F', start=now, end=now + timedelta(hours=1))
        self.client.force_authenticate(self.editor)  # member of self.project, NOT 'other'
        url = f'/api/projects/{self.project.id}/events/{foreign.id}/tasks/'
        self.assertEqual(self.client.post(url, {'title': 'x'}, format='json').status_code, 404)

    def test_list_under_mismatched_event_does_not_leak(self):
        other = Project.objects.create(name='Other2', owner=self.outsider)
        now = timezone.now()
        foreign = Event.objects.create(project=other, title='F2', start=now, end=now + timedelta(hours=1))
        Task.objects.create(event=foreign, title='secret', owner=self.outsider, assignee=self.outsider)
        self.client.force_authenticate(self.editor)
        url = f'/api/projects/{self.project.id}/events/{foreign.id}/tasks/'
        res = self.client.get(url)
        # The event doesn't belong to this project -> 404, so the foreign task never leaks.
        self.assertEqual(res.status_code, 404)
        self.assertNotIn('secret', res.content.decode())


class MembersListAccessTests(TaskTestBase):
    def test_non_owner_member_can_list_members(self):
        # Needed so editors/viewers can populate the task owner/assignee pickers.
        self.client.force_authenticate(self.viewer)
        res = self.client.get(f'/api/projects/{self.project.id}/members/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 3)

    def test_non_owner_cannot_add_members(self):
        self.client.force_authenticate(self.editor)
        res = self.client.post(f'/api/projects/{self.project.id}/members/',
                               {'identifier': 'outsider', 'role': 'viewer'}, format='json')
        self.assertEqual(res.status_code, 403)
