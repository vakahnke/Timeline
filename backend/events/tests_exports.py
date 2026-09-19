from datetime import datetime, timedelta, timezone as dt_tz
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from icalendar import Calendar
from rest_framework.test import APIClient

from projects.models import Project, ProjectMembership, Role

from .ical_export import build_ics
from .models import Event, Task
from .msproject_export import NS, build_mspdi

User = get_user_model()
T0 = datetime(2026, 11, 2, 14, 0, tzinfo=dt_tz.utc)


class _Base(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('pm', 'pm@example.com', 'a-real-Passw0rd')
        self.viewer = User.objects.create_user('lead', 'lead@example.com', 'a-real-Passw0rd')
        self.outsider = User.objects.create_user('nobody', 'n@example.com', 'a-real-Passw0rd')
        self.project = Project.objects.create(name='Launch & <Growth>', owner=self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=Role.VIEWER)
        self.build = Event.objects.create(project=self.project, title='Build; the core, flow', category='Build', start=T0, end=T0 + timedelta(days=10),
                                          percent_complete=40, notes='Line one\nLine two with a very long sentence that goes on well past the seventy-five octet limit of a content line — with an em dash.')
        self.launch = Event.objects.create(project=self.project, title='Public launch', category='Launch', is_milestone=True,
                                           start=T0 + timedelta(days=10), end=T0 + timedelta(days=12, hours=3))
        self.launch.depends_on.set([self.build])
        Task.objects.create(event=self.build, title='Wire the API', status='done', owner=self.owner, assignee=self.owner)
        Task.objects.create(event=self.build, title='Ship the UI', status='todo', owner=self.owner, assignee=self.owner)

    def events(self):
        return list(Event.objects.filter(project=self.project).prefetch_related('depends_on', 'tasks').order_by('start', 'id'))

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c


class IcsBuilderTests(_Base):
    def ics(self):
        return build_ics(self.project, self.events(), host='timeline.example.com', site_url='https://timeline.example.com')

    def test_it_is_a_valid_calendar_that_parses_back(self):
        cal = Calendar.from_ical(self.ics())
        self.assertEqual(str(cal['version']), '2.0')
        self.assertEqual(str(cal['x-wr-calname']), self.project.name)
        self.assertEqual(len(cal.walk('VEVENT')), 2)

    def test_lines_end_in_crlf_and_none_is_longer_than_75_octets(self):
        raw = self.ics()
        self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))                     # every line break is CRLF
        self.assertTrue(all(len(line) <= 75 for line in raw.split(b'\r\n')), max(len(l) for l in raw.split(b'\r\n')))

    def test_text_is_escaped_and_survives_the_round_trip(self):
        raw = self.ics().decode()
        self.assertIn(r'SUMMARY:Build\; the core\, flow', raw)
        build = next(e for e in Calendar.from_ical(self.ics()).walk('VEVENT') if 'Build' in str(e['summary']))
        self.assertEqual(str(build['summary']), 'Build; the core, flow')
        desc = str(build['description'])
        self.assertIn('Line one\nLine two', desc)
        self.assertIn('em dash.', desc)
        self.assertIn('Track: Build', desc)
        self.assertIn('Progress: 40%', desc)
        self.assertIn('1 of 2 tasks done', desc)

    def test_times_are_utc_and_uids_are_stable(self):
        raw = self.ics().decode()
        self.assertIn('DTSTART:20261102T140000Z', raw)
        self.assertIn('DTEND:20261112T140000Z', raw)
        self.assertNotIn('TZID', raw)
        self.assertIn(f'UID:event-{self.build.id}@timeline.example.com', raw)
        self.build.title = 'Renamed'
        self.build.save()
        self.assertIn(f'UID:event-{self.build.id}@timeline.example.com', self.ics().decode())

    def test_a_milestone_is_one_hour_ending_when_the_work_ends_and_is_marked(self):
        ev = next(e for e in Calendar.from_ical(self.ics()).walk('VEVENT') if 'launch' in str(e['summary']))
        self.assertEqual(str(ev['summary']), '◆ Public launch')
        self.assertEqual(ev['dtend'].dt, self.launch.end)
        self.assertEqual(ev['dtend'].dt - ev['dtstart'].dt, timedelta(hours=1))

    def test_dependencies_are_related_to_and_phases_do_not_block_time(self):
        ev = next(e for e in Calendar.from_ical(self.ics()).walk('VEVENT') if 'launch' in str(e['summary']))
        self.assertEqual(str(ev['related-to']), f'event-{self.build.id}@timeline.example.com')
        self.assertEqual(ev['related-to'].params['RELTYPE'], 'PARENT')
        self.assertEqual(str(ev['transp']), 'TRANSPARENT')
        self.assertNotIn('PERCENT-COMPLETE', self.ics().decode())               # only valid on VTODO

    def test_an_empty_project_is_still_a_valid_calendar(self):
        Event.objects.filter(project=self.project).delete()
        self.assertEqual(len(Calendar.from_ical(self.ics()).walk('VEVENT')), 0)


class MsProjectBuilderTests(_Base):
    def root(self, tz='UTC'):
        return ET.fromstring(build_mspdi(self.project, self.events(), tz=ZoneInfo(tz), now=T0))

    def tasks(self, root):
        q = lambda t, tag: (t.find(f'{{{NS}}}{tag}').text if t.find(f'{{{NS}}}{tag}') is not None else None)
        return {q(t, 'Name'): {**{tag: q(t, tag) for tag in ('UID', 'OutlineLevel', 'Summary', 'Milestone', 'Manual', 'Start', 'Finish', 'Duration', 'PercentComplete', 'Notes')},
                               'preds': [p.find(f'{{{NS}}}PredecessorUID').text for p in t.findall(f'{{{NS}}}PredecessorLink')],
                               'types': [p.find(f'{{{NS}}}Type').text for p in t.findall(f'{{{NS}}}PredecessorLink')]}
                for t in root.iter(f'{{{NS}}}Task')}

    def test_it_is_mspdi_and_awkward_names_survive(self):
        root = self.root()
        self.assertEqual(root.tag, f'{{{NS}}}Project')
        self.assertEqual(root.find(f'{{{NS}}}Name').text, 'Launch & <Growth>')

    def test_elements_follow_the_order_the_schema_requires(self):
        # MSPDI is an xs:sequence; this is the order from Microsoft's mspdi_pj12.xsd (plus the 2010
        # manual-scheduling elements where Project writes them). CurrencyCode is mandatory.
        local = lambda el: el.tag.split('}')[1]
        root = self.root()
        self.assertEqual([local(c) for c in root], [
            'SaveVersion', 'Name', 'Title', 'CreationDate', 'ScheduleFromStart', 'StartDate', 'FinishDate', 'CurrencyCode',
            'CalendarUID', 'DefaultStartTime', 'DefaultFinishTime', 'MinutesPerDay', 'MinutesPerWeek', 'DaysPerMonth',
            'NewTasksAreManual', 'Calendars', 'Tasks'])
        task = [t for t in root.iter(f'{{{NS}}}Task') if t.find(f'{{{NS}}}Name').text == 'Public launch'][0]
        self.assertEqual([local(c) for c in task], [
            'UID', 'ID', 'Name', 'Active', 'Manual', 'Type', 'IsNull', 'WBS', 'OutlineNumber', 'OutlineLevel', 'Priority',
            'Start', 'Finish', 'Duration', 'ManualStart', 'ManualFinish', 'ManualDuration', 'DurationFormat', 'Milestone',
            'Summary', 'PercentComplete', 'ConstraintType', 'CalendarUID', 'PredecessorLink'])

    def test_tracks_are_summaries_and_events_are_their_children(self):
        t = self.tasks(self.root())
        self.assertEqual((t['Build']['Summary'], t['Build']['OutlineLevel']), ('1', '1'))
        self.assertEqual((t['Build; the core, flow']['Summary'], t['Build; the core, flow']['OutlineLevel']), ('0', '2'))
        self.assertEqual(t['Launch & <Growth>']['UID'], '0')                     # the project summary row
        self.assertEqual(len({v['UID'] for v in t.values()}), len(t))            # UIDs are unique

    def test_dates_are_kept_by_manual_scheduling_on_a_24_hour_calendar(self):
        root = self.root()
        t = self.tasks(root)['Build; the core, flow']
        self.assertEqual((t['Manual'], t['Start'], t['Finish'], t['Duration']), ('1', '2026-11-02T14:00:00', '2026-11-12T14:00:00', 'PT240H0M0S'))
        self.assertEqual(root.find(f'{{{NS}}}MinutesPerDay').text, '1440')
        days = root.findall(f'.//{{{NS}}}WeekDay')
        self.assertEqual(len(days), 7)
        self.assertTrue(all(d.find(f'{{{NS}}}DayWorking').text == '1' for d in days))

    def test_dates_are_written_in_the_requested_zone_without_an_offset(self):
        t = self.tasks(self.root('America/New_York'))['Build; the core, flow']
        self.assertEqual(t['Start'], '2026-11-02T09:00:00')                       # 14:00 UTC, EST

    def test_dependencies_are_finish_to_start_links_by_uid(self):
        t = self.tasks(self.root())
        self.assertEqual(t['Public launch']['preds'], [t['Build; the core, flow']['UID']])
        self.assertEqual(t['Public launch']['types'], ['1'])
        self.assertEqual(t['Public launch']['Milestone'], '1')

    def test_progress_notes_and_the_todo_list_travel(self):
        t = self.tasks(self.root())['Build; the core, flow']
        self.assertEqual(t['PercentComplete'], '40')
        self.assertIn('Line one', t['Notes'])
        self.assertIn('[x] Wire the API', t['Notes'])
        self.assertIn('[ ] Ship the UI', t['Notes'])

    def test_control_characters_cannot_make_the_file_unreadable(self):
        self.build.notes = 'bad\x0bchar\x1fhere'      # legal in the database, illegal in XML 1.0
        self.build.save()
        self.assertIn('badcharhere', self.tasks(self.root())['Build; the core, flow']['Notes'])

    def test_an_empty_project_is_still_a_valid_file(self):
        Event.objects.filter(project=self.project).delete()
        self.assertEqual(len(list(self.root().iter(f'{{{NS}}}Task'))), 1)


@override_settings(SITE_URL='https://timeline.example.com')
class ExportEndpointTests(_Base):
    def test_members_download_outsiders_and_anonymous_do_not(self):
        for path, ctype, name in ((f'/api/projects/{self.project.id}/calendar.ics', 'text/calendar', 'launch-growth.ics'),
                                  (f'/api/projects/{self.project.id}/export/msproject.xml', 'application/xml', 'launch-growth-msproject.xml')):
            for user in (self.owner, self.viewer):
                r = self.client_for(user).get(path)
                self.assertEqual(r.status_code, 200, path)
                self.assertTrue(r['Content-Type'].startswith(ctype))
                self.assertIn(name, r['Content-Disposition'])
            self.assertEqual(self.client_for(self.outsider).get(path).status_code, 403)
            self.assertEqual(APIClient().get(path).status_code, 401)

    def test_calendar_can_be_limited_to_milestones_or_tracks(self):
        c = self.client_for(self.viewer)
        base = f'/api/projects/{self.project.id}/calendar.ics'
        count = lambda r: len(Calendar.from_ical(r.content).walk('VEVENT'))
        self.assertEqual(count(c.get(base)), 2)
        self.assertEqual(count(c.get(base + '?only=milestones')), 1)
        self.assertEqual(count(c.get(base + '?tracks=Build')), 1)
        self.assertIn(b'@timeline.example.com', c.get(base).content)

    def test_a_bad_time_zone_is_a_clear_400(self):
        c = self.client_for(self.owner)
        path = f'/api/projects/{self.project.id}/export/msproject.xml'
        self.assertEqual(c.get(path + '?timezone=Mars/Olympus').status_code, 400)
        self.assertEqual(c.get(path + '?timezone=Europe/Berlin').status_code, 200)

    def test_exports_change_nothing(self):
        before = (Event.objects.count(), Task.objects.count())
        self.client_for(self.owner).get(f'/api/projects/{self.project.id}/calendar.ics')
        self.client_for(self.owner).get(f'/api/projects/{self.project.id}/export/msproject.xml')
        self.assertEqual((Event.objects.count(), Task.objects.count()), before)
