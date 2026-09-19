from datetime import date, datetime, timedelta, timezone as dt_tz
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Project, ProjectMembership, Role

from .models import Category, Event, StatusReport, Task
from .schedule import critical_path
from .status_report import build_facts, suggest, working_days_between

User = get_user_model()
T0 = datetime(2026, 9, 1, 9, 0, tzinfo=dt_tz.utc)


def ev(i, start_day, days, deps=()):
    s = T0 + timedelta(days=start_day)
    return SimpleNamespace(id=i, start=s, end=s + timedelta(days=days), dep_ids=list(deps))


class CriticalPathTests(TestCase):
    """Pins the server port to the client's algorithm (Timeline.jsx): duration-based,
    finish-to-start, float <= 1 minute is critical, unknown predecessors ignored."""

    def test_empty(self):
        self.assertEqual(critical_path([])['critical_ids'], set())

    def test_single_chain_is_all_critical(self):
        r = critical_path([ev(1, 0, 2), ev(2, 2, 3, [1]), ev(3, 5, 1, [2])])
        self.assertEqual(r['critical_ids'], {1, 2, 3})

    def test_shorter_parallel_branch_has_float(self):
        #  1(2d) -> 2(5d) -> 4(1d)      longest: 8d
        #  1(2d) -> 3(1d) -> 4(1d)      float on 3: 4d
        r = critical_path([ev(1, 0, 2), ev(2, 2, 5, [1]), ev(3, 2, 1, [1]), ev(4, 7, 1, [2, 3])])
        self.assertEqual(r['critical_ids'], {1, 2, 4})
        self.assertEqual(r['float_ms'][3], 4 * 86_400_000)

    def test_calendar_gaps_do_not_create_float(self):
        # Duration-based like the client: where the bars sit on the calendar is irrelevant.
        r = critical_path([ev(1, 0, 2), ev(2, 30, 3, [1])])
        self.assertEqual(r['critical_ids'], {1, 2})

    def test_unknown_predecessor_is_ignored_and_cycles_do_not_hang(self):
        r = critical_path([ev(1, 0, 2, [99]), ev(2, 2, 2, [3]), ev(3, 4, 2, [2])])
        self.assertEqual(set(r['order']), {1, 2, 3})


class WorkingDaysTests(TestCase):
    def test_counts_weekdays_only_and_is_signed(self):
        fri, mon, next_fri = date(2026, 9, 4), date(2026, 9, 7), date(2026, 9, 11)
        self.assertEqual(working_days_between(fri, mon), 1)
        self.assertEqual(working_days_between(fri, next_fri), 5)
        self.assertEqual(working_days_between(next_fri, fri), -5)
        self.assertEqual(working_days_between(fri, fri), 0)


class _ProjectCase(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('pm', 'pm@example.com', 'a-real-Passw0rd')
        self.viewer = User.objects.create_user('lead', 'lead@example.com', 'a-real-Passw0rd')
        self.outsider = User.objects.create_user('nobody', 'n@example.com', 'a-real-Passw0rd')
        self.project = Project.objects.create(name='Launch', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=Role.VIEWER)
        Category.objects.create(project=self.project, name='Build', color='#2f6fe0')
        self.now = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)

    def add(self, title, start_days, length_days, pct=0, cat='Build', milestone=False, deps=()):
        e = Event.objects.create(project=self.project, title=title, category=cat,
                                 start=self.now + timedelta(days=start_days),
                                 end=self.now + timedelta(days=start_days + length_days),
                                 percent_complete=pct, is_milestone=milestone)
        e.depends_on.set(deps)
        return e


class FactsAndRulesTests(_ProjectCase):
    def test_empty_project(self):
        facts = build_facts(self.project, now=self.now)
        self.assertTrue(facts['empty'])
        self.assertEqual(suggest(facts)['status'], 'on_track')

    def test_progress_is_weighted_by_duration_and_lists_are_filled(self):
        a = self.add('Design', -20, 10, pct=100)                      # finished 10 days ago
        b = self.add('Build', -10, 30, pct=50, deps=[a])              # in flight
        self.add('Ship', 20, 1, pct=0, milestone=True, deps=[b])      # due in 3 weeks
        facts = build_facts(self.project, now=self.now, since=self.now - timedelta(days=14))
        # 10d*100% + 30d*50% + 1d*0%  over 41d  = 61%
        self.assertEqual(facts['progress'], 61)
        self.assertEqual([e['title'] for e in facts['completed_recently']], ['Design'])
        # Both end inside the three-week look-ahead; listed in date order.
        self.assertEqual([e['title'] for e in facts['due_next']], ['Build', 'Ship'])
        self.assertEqual(len(facts['milestones']), 1)
        self.assertEqual(facts['rows'][0]['name'], 'Build')
        self.assertEqual(facts['rows'][0]['color'], '#2f6fe0')
        self.assertIsNone(facts['variance_days'])                     # no commitment set

    def test_late_against_commitment_is_at_risk_then_off_track(self):
        self.add('Build', -10, 20, pct=50)                            # ends in 10 days
        end = timezone.localtime(self.now + timedelta(days=10)).date()
        self.project.committed_end = end - timedelta(days=1)
        self.project.save()
        s = suggest(build_facts(self.project, now=self.now))
        self.assertEqual(s['status'], 'at_risk')
        self.assertIn('past commitment', s['rule_fired'])
        self.assertIn('past the', s['headline'])

        self.project.committed_end = end - timedelta(days=30)
        self.project.save()
        self.assertEqual(suggest(build_facts(self.project, now=self.now))['status'], 'off_track')

    def test_on_or_ahead_of_commitment_is_on_track(self):
        self.add('Build', -10, 20, pct=55)
        self.project.committed_end = timezone.localtime(self.now + timedelta(days=12)).date()
        self.project.save()
        s = suggest(build_facts(self.project, now=self.now))
        self.assertEqual(s['status'], 'on_track')
        self.assertIn('ahead of', s['headline'])

    def test_missed_milestone_is_off_track(self):
        self.add('Go / no-go', -5, 1, pct=0, milestone=True)
        self.add('Build', -10, 40, pct=30)
        s = suggest(build_facts(self.project, now=self.now))
        self.assertEqual(s['status'], 'off_track')
        self.assertIn('milestone', s['rule_fired'])

    def test_blocked_task_on_the_critical_path_is_at_risk(self):
        e = self.add('Build', -2, 20, pct=10)
        Task.objects.create(event=e, title='Vendor quote', status=Task.Status.BLOCKED,
                            owner=self.owner, assignee=self.owner)
        s = suggest(build_facts(self.project, now=self.now))
        self.assertEqual(s['status'], 'at_risk')
        self.assertIn('critical path', s['rule_fired'])

    def test_work_well_behind_time_is_at_risk(self):
        self.add('Build', -18, 20, pct=20)                            # 90% elapsed, 20% done
        s = suggest(build_facts(self.project, now=self.now))
        self.assertEqual(s['status'], 'at_risk')
        self.assertIn('behind', s['rule_fired'])

    def test_many_tracks_roll_up_into_other(self):
        for i in range(9):
            self.add(f'E{i}', i, 2, cat=f'Track {i}')
        rows = build_facts(self.project, now=self.now)['rows']
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[-1]['name'], 'Other')
        self.assertEqual(rows[-1]['event_count'], 3)


class StatusReportApiTests(_ProjectCase):
    def url(self, suffix=''):
        return f'/api/projects/{self.project.id}/status-reports/{suffix}'

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def payload(self, **over):
        p = {'as_of': self.now.isoformat(), 'layout': 'slide', 'status': 'at_risk',
             'status_source': 'rule', 'rule_fired': 'forecast finish 3 days past commitment',
             'suggested_status': 'at_risk', 'content': {'headline': 'Three days late.'},
             'snapshot': {'progress': 45}}
        p.update(over)
        return p

    def test_draft_returns_facts_suggestion_and_previous(self):
        self.add('Build', -5, 20, pct=20)
        r = self.client_for(self.viewer).get(self.url('draft/'))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['facts']['event_count'], 1)
        self.assertIn(r.data['suggestion']['status'], {'on_track', 'at_risk', 'off_track'})
        self.assertIsNone(r.data['previous'])

    def test_editor_saves_and_next_draft_starts_from_it(self):
        c = self.client_for(self.owner)
        r = c.post(self.url(), self.payload(), format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['author_name'], 'pm')
        d = c.get(self.url('draft/'))
        self.assertEqual(d.data['previous']['content']['headline'], 'Three days late.')
        lst = c.get(self.url())
        self.assertEqual(lst.data[0]['headline'], 'Three days late.')
        self.assertNotIn('snapshot', lst.data[0])                     # the list stays light

    def test_override_requires_a_reason(self):
        c = self.client_for(self.owner)
        bad = c.post(self.url(), self.payload(status='on_track', status_source='override'), format='json')
        self.assertEqual(bad.status_code, 400)
        ok = c.post(self.url(), self.payload(status='on_track', status_source='override',
                                             override_reason='Sponsor agreed a new date on Sep 18.'), format='json')
        self.assertEqual(ok.status_code, 201)

    def test_viewer_reads_but_cannot_write_and_outsider_sees_nothing(self):
        rid = self.client_for(self.owner).post(self.url(), self.payload(), format='json').data['id']
        v = self.client_for(self.viewer)
        self.assertEqual(v.get(self.url(f'{rid}/')).status_code, 200)
        self.assertEqual(v.post(self.url(), self.payload(), format='json').status_code, 403)
        self.assertEqual(v.patch(self.url(f'{rid}/'), {'layout': 'handout'}, format='json').status_code, 403)
        self.assertEqual(v.delete(self.url(f'{rid}/')).status_code, 403)
        o = self.client_for(self.outsider)
        self.assertEqual(o.get(self.url()).status_code, 403)
        self.assertEqual(o.get(self.url('draft/')).status_code, 403)
        self.assertEqual(StatusReport.objects.count(), 1)

    def test_content_must_be_a_bounded_object(self):
        c = self.client_for(self.owner)
        self.assertEqual(c.post(self.url(), self.payload(content=['nope']), format='json').status_code, 400)
        self.assertEqual(c.post(self.url(), self.payload(content={'x': 'y' * 250_000}), format='json').status_code, 400)

    def test_milestone_flag_and_committed_date_round_trip(self):
        c = self.client_for(self.owner)
        e = self.add('Ship', 5, 1)
        r = c.patch(f'/api/projects/{self.project.id}/events/{e.id}/', {'is_milestone': True}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['is_milestone'])
        p = c.patch(f'/api/projects/{self.project.id}/', {'committed_end': '2026-11-03'}, format='json')
        self.assertEqual(p.status_code, 200, p.data)
        self.assertEqual(p.data['committed_end'], '2026-11-03')
