import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Project, ProjectMembership, Role

from .models import Baseline, Event, StatusReport
from .status_report import build_facts, history_from, suggest

User = get_user_model()


class _Base(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('pm', 'pm@example.com', 'a-real-Passw0rd')
        self.viewer = User.objects.create_user('lead', 'lead@example.com', 'a-real-Passw0rd')
        self.outsider = User.objects.create_user('nobody', 'n@example.com', 'a-real-Passw0rd')
        self.project = Project.objects.create(name='Launch', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=Role.VIEWER)
        self.now = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        n = self.now
        self.a = Event.objects.create(project=self.project, title='Build', category='Build', is_milestone=True,
                                      start=n - timedelta(days=10), end=n + timedelta(days=10), percent_complete=50)
        self.b = Event.objects.create(project=self.project, title='Launch', category='Launch', is_milestone=True,
                                      start=n + timedelta(days=10), end=n + timedelta(days=20), percent_complete=0)
        self.b.depends_on.set([self.a])

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def url(self, tail=''):
        return f'/api/projects/{self.project.id}/baselines/{tail}'

    def take(self, name='Approved plan'):
        r = self.client_for(self.owner).post(self.url(), {'name': name}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()


class BaselineApiTests(_Base):
    def test_taking_a_baseline_freezes_every_event(self):
        self.project.committed_end = timezone.localtime(self.now + timedelta(days=20)).date()
        self.project.save()
        data = self.take()
        self.assertTrue(data['active'])
        self.assertEqual(data['event_count'], 2)
        self.assertEqual(data['committed_end'], self.project.committed_end.isoformat())
        frozen = Baseline.objects.get(id=data['id']).events
        self.assertEqual(frozen[str(self.b.id)]['end'], self.b.end.isoformat())

    def test_a_new_baseline_retires_the_old_one_and_deleting_restores_it(self):
        first = self.take('v1')
        second = self.take('v2')
        self.assertEqual(list(Baseline.objects.filter(project=self.project, active=True).values_list('id', flat=True)), [second['id']])
        r = self.client_for(self.owner).delete(self.url(f"{second['id']}/"))
        self.assertEqual(r.status_code, 204)
        self.assertTrue(Baseline.objects.get(id=first['id']).active)

    def test_viewers_read_but_cannot_take_or_delete_and_outsiders_see_nothing(self):
        made = self.take()
        v = self.client_for(self.viewer)
        self.assertEqual(v.get(self.url()).status_code, 200)
        self.assertEqual(v.post(self.url(), {'name': 'x'}, format='json').status_code, 403)
        self.assertEqual(v.delete(self.url(f"{made['id']}/")).status_code, 403)
        self.assertEqual(self.client_for(self.outsider).get(self.url()).status_code, 403)
        self.assertEqual(APIClient().get(self.url()).status_code, 401)

    def test_a_name_is_required(self):
        r = self.client_for(self.owner).post(self.url(), {'name': '  '}, format='json')
        self.assertEqual(r.status_code, 400)


class BaselineFactsTests(_Base):
    def test_no_baseline_means_no_slip_fields(self):
        f = build_facts(self.project, now=self.now)
        self.assertIsNone(f['baseline'])
        self.assertIsNone(f['milestones'][0]['slip_days'])
        self.assertIsNone(f['rows'][0]['baseline_end'])

    def test_slip_is_measured_per_event_per_row_and_at_the_finish(self):
        self.take()
        self.b.start += timedelta(days=4)
        self.b.end += timedelta(days=4)
        self.b.save()
        added = Event.objects.create(project=self.project, title='Extra', category='Launch',
                                     start=self.now, end=self.now + timedelta(days=2))
        f = json.loads(json.dumps(build_facts(self.project, now=self.now)))
        self.assertEqual(f['baseline']['finish_slip_days'], 4)
        self.assertEqual((f['baseline']['moved'], f['baseline']['added'], f['baseline']['removed']), (1, 1, 0))
        ms = {m['title']: m for m in f['milestones']}
        self.assertEqual(ms['Launch']['slip_days'], 4)
        self.assertEqual(ms['Build']['slip_days'], 0)
        rows = {r['name']: r for r in f['rows']}
        self.assertEqual(rows['Launch']['slip_days'], 4)
        self.assertEqual(rows['Build']['slip_days'], 0)
        ev = {e['id']: e for e in f['events']}
        self.assertIsNone(ev[added.id]['slip_days'])                 # newer than the baseline

    def test_without_a_committed_date_the_baseline_finish_is_the_commitment(self):
        self.take()
        self.b.end += timedelta(days=2)
        self.b.save()
        f = build_facts(self.project, now=self.now)
        self.assertEqual(f['project']['commitment_source'], 'baseline')
        self.assertEqual(f['variance_days'], 2)
        s = suggest(f)
        self.assertEqual(s['status'], 'at_risk')
        self.assertIn('baseline', s['rule_fired'])
        self.assertIn('baseline', s['headline'])

    def test_a_committed_date_wins_over_the_baseline(self):
        self.take()
        self.project.committed_end = timezone.localtime(self.b.end + timedelta(days=5)).date()
        self.project.save()
        f = build_facts(self.project, now=self.now)
        self.assertEqual(f['project']['commitment_source'], 'project')
        self.assertEqual(f['variance_days'], -5)


class ThresholdTests(_Base):
    def test_project_thresholds_change_the_verdict(self):
        self.project.committed_end = timezone.localtime(self.b.end - timedelta(days=3)).date()   # 3 days late on a 30-day plan
        self.project.save()
        self.assertEqual(suggest(build_facts(self.project, now=self.now))['status'], 'at_risk')
        self.project.status_thresholds = {'off_track_working_days': 1, 'off_track_percent': 5}
        self.project.save()
        f = build_facts(self.project, now=self.now)
        self.assertEqual(f['thresholds']['off_track_working_days'], 1)
        self.assertEqual(f['thresholds']['behind_points'], 10)                     # default kept
        self.assertEqual(suggest(f)['status'], 'off_track')

    def test_thresholds_are_validated_and_editor_only(self):
        url = f'/api/projects/{self.project.id}/'
        c = self.client_for(self.owner)
        self.assertEqual(c.patch(url, {'status_thresholds': {'off_track_working_days': 5}}, format='json').status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.status_thresholds, {'off_track_working_days': 5})
        for bad in ({'off_track_working_days': 0}, {'nonsense': 3}, {'behind_points': 'ten'}, {'off_track_percent': 2.5}, [1]):
            self.assertEqual(c.patch(url, {'status_thresholds': bad}, format='json').status_code, 400, bad)
        self.assertEqual(c.patch(url, {'status_thresholds': {'behind_points': None}}, format='json').status_code, 200)
        self.assertIn(self.client_for(self.viewer).patch(url, {'status_thresholds': {}}, format='json').status_code, (403, 404))


class SinceLastReportTests(_Base):
    def save_report(self, when):
        f = json.loads(json.dumps(build_facts(self.project, now=when)))
        return StatusReport.objects.create(project=self.project, author=self.owner, as_of=when, status=suggest(f)['status'],
                                           content={'headline': 'x'}, snapshot=f)

    def test_what_moved_is_computed_against_the_previous_snapshot(self):
        prev = self.save_report(self.now - timedelta(days=7))
        self.b.end += timedelta(days=3)
        self.b.save()
        self.a.percent_complete = 80
        self.a.save()
        f = build_facts(self.project, now=self.now, previous_snapshot=prev.snapshot)
        sl = f['since_last']
        self.assertEqual(sl['finish_days'], 3)
        self.assertEqual([(m['title'], m['days']) for m in sl['moved']], [('Launch', 3)])
        self.assertGreater(sl['progress_points'], 0)

    def test_draft_endpoint_carries_history_oldest_first(self):
        for d in (21, 14, 7):
            self.save_report(self.now - timedelta(days=d))
        r = self.client_for(self.viewer).get(f'/api/projects/{self.project.id}/status-reports/draft/')
        self.assertEqual(r.status_code, 200)
        h = r.json()['facts']['history']
        self.assertEqual(len(h), 3)
        self.assertLess(h[0]['as_of'], h[-1]['as_of'])
        self.assertIn(str(self.b.id), h[0]['milestones'])
        self.assertIsNotNone(r.json()['facts']['since_last'])

    def test_history_skips_reports_of_an_empty_schedule(self):
        StatusReport.objects.create(project=self.project, author=self.owner, as_of=self.now, status='on_track', content={}, snapshot={'as_of': 'x'})
        self.assertEqual(history_from(StatusReport.objects.filter(project=self.project)), [])
