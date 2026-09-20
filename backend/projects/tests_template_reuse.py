"""A finished project becomes a plan you can run again.

The README's promise is to "share the successful result": save any project as a template, start the
next one from it on a new date. These tests hold that promise through the real API: the plan comes
back whole, and nothing that belonged to the first run (dates, progress, who did what) comes with it.
"""
from datetime import datetime, timedelta, timezone as dt_tz

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from events.models import Event, Task
from projects.models import Project, ProjectMembership, ProjectTemplate, Role

User = get_user_model()
T0 = datetime(2026, 3, 2, 9, 0, tzinfo=dt_tz.utc)


class ReuseAFinishedProjectTests(APITestCase):
    def setUp(self):
        self.pm = User.objects.create_user('pm', 'pm@example.com', 'pw')
        self.helper = User.objects.create_user('helper', 'helper@example.com', 'pw')
        self.done = Project.objects.create(name='Spring launch', owner=self.pm)
        ProjectMembership.objects.create(project=self.done, user=self.pm, role=Role.OWNER)
        ProjectMembership.objects.create(project=self.done, user=self.helper, role=Role.EDITOR)
        self.build = Event.objects.create(project=self.done, title='Build', category='Engineering', notes='Ship one job end to end.',
                                          start=T0, end=T0 + timedelta(days=10), percent_complete=100)
        self.launch = Event.objects.create(project=self.done, title='Launch', category='Go-to-market', is_milestone=True,
                                           start=T0 + timedelta(days=10), end=T0 + timedelta(days=12), percent_complete=100)
        self.launch.depends_on.set([self.build])
        Task.objects.create(event=self.build, title='Wire the API', status='done', owner=self.pm, assignee=self.helper,
                            due_date=(T0 + timedelta(days=4)).date(), order=0)
        Task.objects.create(event=self.build, title='Load test', status='blocked', owner=self.pm, assignee=self.helper, order=1)
        self.client.force_authenticate(self.pm)

    def reuse(self, start):
        saved = self.client.post('/api/templates/', {'project': self.done.id, 'name': 'Launch playbook'}, format='json')
        self.assertEqual(saved.status_code, 201, saved.content)
        made = self.client.post('/api/templates/instantiate/', {'key': saved.data['key'], 'start': start.isoformat(), 'name': 'Autumn launch'}, format='json')
        self.assertEqual(made.status_code, 201, made.content)
        return Project.objects.get(id=made.data['id'])

    def test_the_plan_comes_back_whole_on_the_new_date(self):
        start = datetime(2026, 9, 7, 9, 0, tzinfo=dt_tz.utc)
        new = self.reuse(start)
        ev = {e.title: e for e in new.events.all()}
        self.assertEqual(set(ev), {'Build', 'Launch'})
        self.assertEqual((ev['Build'].start, ev['Build'].end), (start, start + timedelta(days=10)))          # durations kept
        self.assertEqual(ev['Launch'].start, start + timedelta(days=10))                                      # relative timing kept
        self.assertEqual(list(ev['Launch'].depends_on.all()), [ev['Build']])                                  # dependencies kept
        self.assertEqual((ev['Build'].category, ev['Build'].notes), ('Engineering', 'Ship one job end to end.'))
        self.assertTrue(ev['Launch'].is_milestone)                                                            # key milestones kept
        self.assertFalse(ev['Build'].is_milestone)

    def test_nothing_from_the_first_run_comes_with_it(self):
        new = self.reuse(datetime(2026, 9, 7, 9, 0, tzinfo=dt_tz.utc))
        self.assertEqual(set(new.events.values_list('percent_complete', flat=True)), {0})                     # starts at zero
        todos = list(Task.objects.filter(event__project=new).order_by('order'))
        self.assertEqual([t.title for t in todos], ['Wire the API', 'Load test'])                             # the checklist survives
        self.assertEqual({t.status for t in todos}, {'todo'})                                                 # nobody has done it yet
        self.assertEqual({(t.owner_id, t.assignee_id) for t in todos}, {(self.pm.id, self.pm.id)})            # and it is yours now
        self.assertEqual(todos[0].due_date, datetime(2026, 9, 11).date())                                     # 4 days in, on the new calendar
        self.assertIsNone(todos[1].due_date)
        self.assertEqual(set(new.memberships.values_list('user_id', flat=True)), {self.pm.id})                # last run's team is not copied

    def test_a_template_saved_before_this_rule_still_starts_at_zero(self):
        old = ProjectTemplate.objects.create(owner=self.pm, name='Old', categories=[], tasks=[
            {'title': 'Legacy', 'category': 'X', 'start_offset_minutes': 0, 'duration_minutes': 60, 'percent_complete': 100, 'depends_on': []}])
        made = self.client.post('/api/templates/instantiate/', {'key': f'saved:{old.id}', 'start': T0.isoformat()}, format='json')
        self.assertEqual(made.status_code, 201, made.content)
        self.assertEqual(Event.objects.get(project_id=made.data['id']).percent_complete, 0)

    def test_the_original_project_is_untouched(self):
        self.reuse(datetime(2026, 9, 7, 9, 0, tzinfo=dt_tz.utc))
        self.build.refresh_from_db()
        self.assertEqual((self.build.percent_complete, self.build.start), (100, T0))
        self.assertEqual(Task.objects.filter(event=self.build, status='done').count(), 1)
