"""Closing out a run, and what a template may show from it (docs/design/template-closeout.md).

Cost is more sensitive than dates. These tests hold the promises made about it: owners only,
every answer optional, totals only, a minimum of three figures in one currency, a median and
never a lowest or highest, rounding, and a per-run way to keep figures out.
"""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .library import round_sig, track_records
from .models import Project, ProjectMembership, ProjectTemplate, RunCloseout

User = get_user_model()
KEY = 'builtin:sprint'
START = timezone.now().isoformat()          # a run that began just now is in flight, not stalled


class CloseoutCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('olga', 'olga@example.com', 'pw')
        self.editor = User.objects.create_user('ed', 'ed@example.com', 'pw')
        self.viewer = User.objects.create_user('vic', 'vic@example.com', 'pw')
        self.stranger = User.objects.create_user('sue', 'sue@example.com', 'pw')
        self.project = self.run_of(KEY, self.owner)
        ProjectMembership.objects.create(project=self.project, user=self.editor, role='editor')
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role='viewer')
        self.url = f'/api/projects/{self.project.id}/closeout/'

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client

    def run_of(self, key, user):
        res = self.as_(user).post('/api/templates/instantiate/', {'key': key, 'start': START}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return Project.objects.get(pk=res.data['id'])

    def close(self, project, user=None, **answers):
        res = self.as_(user or self.owner).put(f'/api/projects/{project.id}/closeout/', answers, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        return res

    def state(self, project=None, user=None):
        return self.as_(user or self.owner).get(f'/api/projects/{(project or self.project).id}/').data['closeout_state']


class WhoMayCloseOut(CloseoutCase):
    def test_only_an_owner_writes_deletes_or_dismisses(self):
        for user in (self.editor, self.viewer):
            c = self.as_(user)
            self.assertEqual(c.put(self.url, {'outcome': 'worked'}, format='json').status_code, 403)
            self.assertEqual(c.delete(self.url).status_code, 403)
            self.assertEqual(c.post(self.url + 'dismiss/').status_code, 403)
        self.assertFalse(RunCloseout.objects.exists())

    def test_a_stranger_gets_404_not_403(self):
        c = self.as_(self.stranger)
        self.assertEqual(c.get(self.url).status_code, 404)
        self.assertEqual(c.put(self.url, {'outcome': 'worked'}, format='json').status_code, 404)

    def test_members_can_read_it(self):
        self.close(self.project, outcome='worked', cost_amount='1200', cost_currency='usd', lesson='Start earlier.')
        data = self.as_(self.viewer).get(self.url).data
        self.assertEqual((data['outcome'], data['cost_amount'], data['cost_currency'], data['closed_by']),
                         ('worked', '1200.00', 'USD', 'olga'))

    def test_the_client_cannot_choose_who_closed_it_or_which_project(self):
        other = self.run_of(KEY, self.stranger)
        res = self.as_(self.owner).put(self.url, {'outcome': 'worked', 'closed_by': 'sue', 'project': other.id}, format='json')
        self.assertEqual(res.status_code, 201)
        closeout = RunCloseout.objects.get()
        self.assertEqual((closeout.project_id, closeout.closed_by_id), (self.project.id, self.owner.id))


class TheAnswers(CloseoutCase):
    def test_every_answer_is_optional(self):
        self.close(self.project)
        self.assertEqual(self.state(), 'closed')

    def test_it_can_be_edited_and_removed(self):
        self.assertEqual(self.close(self.project, outcome='worked').status_code, 201)
        self.assertEqual(self.close(self.project, outcome='did_not_work').status_code, 200)
        self.assertEqual(RunCloseout.objects.get().outcome, 'did_not_work')
        self.assertEqual(self.as_(self.owner).delete(self.url).status_code, 204)
        self.assertEqual(self.as_(self.owner).get(self.url).status_code, 204)

    def test_bad_answers_are_refused(self):
        c = self.as_(self.owner)
        for bad in ({'cost_amount': '-5'}, {'effort_person_days': '-1'}, {'outcome': 'brilliant'},
                    {'cost_amount': '10', 'cost_currency': 'dollars'}, {'lesson': 'x' * 501}):
            self.assertEqual(c.put(self.url, bad, format='json').status_code, 400, bad)

    def test_a_cost_without_a_currency_takes_the_server_default(self):
        self.close(self.project, cost_amount='900')
        self.assertEqual(RunCloseout.objects.get().cost_currency, 'USD')


class WhenItIsOffered(CloseoutCase):
    def test_offered_only_when_a_template_run_is_completely_done(self):
        self.assertEqual(self.state(), 'none')
        self.project.events.update(percent_complete=100)
        self.assertEqual(self.state(), 'offered')
        one = self.project.events.first()
        one.percent_complete = 90
        one.save()
        self.assertEqual(self.state(), 'none')

    def test_a_project_not_from_a_template_is_never_offered_but_can_be_closed(self):
        res = self.as_(self.owner).post('/api/projects/', {'name': 'Blank'}, format='json')
        blank = Project.objects.get(pk=res.data['id'])
        self.assertEqual(self.state(blank), 'none')
        self.close(blank, outcome='worked')
        self.assertEqual(self.state(blank), 'closed')

    def test_not_now_is_remembered(self):
        self.project.events.update(percent_complete=100)
        self.assertEqual(self.as_(self.owner).post(self.url + 'dismiss/').status_code, 204)
        self.assertEqual(self.state(), 'dismissed')
        self.assertEqual(self.state(user=self.editor), 'dismissed')

    def test_the_project_list_reports_the_same_state(self):
        self.project.events.update(percent_complete=100)
        listed = {p['id']: p['closeout_state'] for p in self.as_(self.owner).get('/api/projects/').data}
        self.assertEqual(listed[self.project.id], 'offered')


class WhatATemplateShows(CloseoutCase):
    def record(self):
        return track_records([KEY])[KEY]

    def many(self, answers):
        for a in answers:
            self.close(self.run_of(KEY, self.owner), **a)

    def test_nothing_below_three(self):
        self.many([{'outcome': 'worked', 'cost_amount': '1000', 'effort_person_days': '10'}] * 2)
        rec = self.record()
        self.assertEqual((rec['closed'], rec['outcomes'], rec['cost'], rec['effort']), (2, None, None, None))

    def test_outcomes_cost_and_effort_at_three(self):
        self.many([{'outcome': 'worked', 'cost_amount': '1000', 'effort_person_days': '10'},
                   {'outcome': 'worked_with_changes', 'cost_amount': '13870', 'effort_person_days': '46'},
                   {'outcome': 'did_not_work', 'cost_amount': '90000', 'effort_person_days': '300'}])
        rec = self.record()
        self.assertEqual(rec['outcomes'], {'worked': 1, 'worked_with_changes': 1, 'did_not_work': 1, 'stopped': 0})
        self.assertEqual(rec['cost'], {'median': 14000.0, 'currency': 'USD', 'runs': 3})     # 13,870 rounded
        self.assertEqual(rec['effort'], {'median_days': 46.0, 'runs': 3})

    def test_it_never_carries_a_lowest_highest_mean_or_any_single_figure(self):
        self.many([{'cost_amount': '1000'}, {'cost_amount': '13870'}, {'cost_amount': '90000'}])
        rec = self.record()
        self.assertEqual(set(rec['cost']), {'median', 'currency', 'runs'})
        flat = str(rec)
        for leak in ('1000', '90000', '13870', '34956'):            # min, max, exact median, mean
            self.assertNotIn(leak, flat)

    def test_currencies_are_never_mixed(self):
        self.many([{'cost_amount': '100', 'cost_currency': 'EUR'}, {'cost_amount': '200', 'cost_currency': 'EUR'},
                   {'cost_amount': '5000', 'cost_currency': 'USD'}, {'cost_amount': '6000', 'cost_currency': 'USD'}])
        self.assertIsNone(self.record()['cost'])                     # four figures, but no three alike
        self.many([{'cost_amount': '300', 'cost_currency': 'EUR'}])
        self.assertEqual(self.record()['cost'], {'median': 200.0, 'currency': 'EUR', 'runs': 3})

    def test_a_run_can_keep_its_figures_out_but_still_say_how_it_went(self):
        self.many([{'outcome': 'worked', 'cost_amount': '1000'}, {'outcome': 'worked', 'cost_amount': '2000'},
                   {'outcome': 'worked', 'cost_amount': '999999', 'share_figures': False}])
        rec = self.record()
        self.assertIsNone(rec['cost'])
        self.assertEqual(rec['outcomes']['worked'], 3)

    def test_a_project_kept_out_of_the_record_contributes_nothing(self):
        self.many([{'outcome': 'worked', 'cost_amount': '1000'}] * 3)
        hidden = Project.objects.filter(source_template_key=KEY).exclude(pk=self.project.pk).first()
        self.as_(self.owner).patch(f'/api/projects/{hidden.id}/', {'count_in_track_record': False}, format='json')
        rec = self.record()
        self.assertEqual((rec['closed'], rec['cost'], rec['outcomes']), (2, None, None))

    def test_rounding_hides_a_small_move_in_the_median(self):
        self.many([{'cost_amount': '10000'}, {'cost_amount': '10100'}, {'cost_amount': '10200'}])
        before = self.record()['cost']['median']
        self.many([{'cost_amount': '10150'}])
        self.assertEqual(before, self.record()['cost']['median'])
        self.assertEqual([round_sig(v) for v in (13870, 0.456, 45, 0)], [14000.0, 0.46, 45.0, 0.0])

    def test_closing_out_settles_a_run(self):
        self.assertEqual(self.record()['in_flight'], 1)
        self.close(self.project, outcome='stopped')
        rec = self.record()
        self.assertEqual((rec['started'], rec['finished'], rec['in_flight'], rec['abandoned'], rec['stopped']), (1, 0, 0, 0, 1))
        self.close(self.project, outcome='worked_with_changes')          # not every event at 100%
        rec = self.record()
        self.assertEqual((rec['finished'], rec['stopped'], rec['in_flight']), (1, 0, 0))

    def test_lessons_and_single_closeouts_never_reach_the_template_api(self):
        tpl = ProjectTemplate.objects.create(owner=self.owner, name='T', visibility='instance',
                                             categories=[], tasks=[{'title': 'A', 'category': 'X', 'start_offset_minutes': 0, 'duration_minutes': 60}])
        key = f'saved:{tpl.id}'
        for _ in range(3):
            self.close(self.run_of(key, self.owner), outcome='worked', cost_amount='4321', lesson='SECRET-LESSON')
        body = str(self.as_(self.stranger).get(f'/api/templates/{key}/').data)
        self.assertNotIn('SECRET-LESSON', body)
        self.assertNotIn('4321', body)
        self.assertIn("'median': 4300.0", body)


class TheOriginalRun(CloseoutCase):
    """Phase B: the project a template was saved from is the plan's first run."""

    def save_template(self, project, user=None):
        res = self.as_(user or self.owner).post('/api/templates/', {'project': project.id, 'name': 'From a real run'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return res.data['key']

    def test_a_new_template_starts_with_one_run_not_none(self):
        self.project.events.update(percent_complete=100)
        key = self.save_template(self.project)
        rec = track_records([key])[key]
        self.assertEqual((rec['started'], rec['finished'], rec['in_flight']), (1, 1, 0))

    def test_its_closeout_is_the_templates_first_word_but_still_needs_three(self):
        self.close(self.project, outcome='worked', cost_amount='5000')
        key = self.save_template(self.project)
        rec = track_records([key])[key]
        self.assertEqual((rec['closed'], rec['outcomes'], rec['cost']), (1, None, None))
        for _ in range(2):
            self.close(self.run_of(key, self.owner), outcome='worked', cost_amount='7000')
        rec = track_records([key])[key]
        self.assertEqual((rec['closed'], rec['outcomes']['worked'], rec['cost']['median']), (3, 3, 7000.0))

    def test_the_original_run_never_enters_the_ratio(self):
        self.project.events.update(percent_complete=100)
        key = self.save_template(self.project)
        for _ in range(2):
            self.run_of(key, self.owner).events.update(percent_complete=100)
        self.assertIsNone(track_records([key])[key]['typical_ratio'])        # 3 finished, only 2 comparable
        self.run_of(key, self.owner).events.update(percent_complete=100)
        self.assertIsNotNone(track_records([key])[key]['typical_ratio'])

    def test_the_original_run_honours_the_opt_out(self):
        key = self.save_template(self.project)
        self.as_(self.owner).patch(f'/api/projects/{self.project.id}/', {'count_in_track_record': False}, format='json')
        self.assertEqual(track_records([key])[key]['started'], 0)

    def test_the_origin_is_never_exposed_or_copied_to_a_fork(self):
        key = self.save_template(self.project)
        self.as_(self.owner).patch(f'/api/templates/{key}/', {'visibility': 'instance'}, format='json')
        detail = self.as_(self.stranger).get(f'/api/templates/{key}/').data
        self.assertNotIn('origin_project', detail)
        self.assertNotIn(self.project.name, str(detail['track_record']))
        fork = self.as_(self.stranger).post(f'/api/templates/{key}/fork/').data
        self.assertIsNone(ProjectTemplate.objects.get(pk=fork['id']).origin_project_id)
        self.assertEqual(fork['track_record']['started'], 0)


class SharedPlanCase(CloseoutCase):
    """A template that tia owns and everyone can see, and one run of it by olga."""

    def setUp(self):
        super().setUp()
        self.author = User.objects.create_user('tia', 'tia@example.com', 'pw')
        self.staff = User.objects.create_user('sam', 'sam@example.com', 'pw', is_staff=True)
        self.tpl = ProjectTemplate.objects.create(
            owner=self.author, name='Shared plan', visibility='instance', categories=[],
            tasks=[{'title': 'A', 'category': 'X', 'start_offset_minutes': 0, 'duration_minutes': 60}])
        self.key = f'saved:{self.tpl.id}'
        self.run = self.run_of(self.key, self.owner)


class LessonsSentBeforeLessonsLearned(SharedPlanCase):
    """Phase B sent lessons privately to the template's owner. Nothing new goes there, and the ones
    already sent stay where their dialog said they would."""

    def setUp(self):
        super().setUp()
        self.lessons_url = f'/api/templates/{self.key}/lessons/'

    def sent(self, project, user=None, **answers):
        self.close(project, user=user, **answers)
        RunCloseout.objects.filter(project=project).update(lesson_to_owner=True)     # as phase B saved it

    def lessons(self):
        res = self.as_(self.author).get(self.lessons_url)
        self.assertEqual(res.status_code, 200)
        return res.data

    def test_only_the_templates_owner_reads_them(self):
        self.sent(self.run, lesson='Book the venue first.')
        self.assertEqual(self.as_(self.owner).get(self.lessons_url).status_code, 403)     # can see the template, not these
        self.assertEqual(self.as_(self.stranger).get(self.lessons_url).status_code, 403)
        self.assertEqual(self.as_(self.staff).get(self.lessons_url).status_code, 403)
        self.as_(self.author).post(f'/api/templates/{self.key}/unpublish/')
        self.assertEqual(self.as_(self.owner).get(self.lessons_url).status_code, 404)     # and now not even that

    def test_text_and_date_and_no_project_name_for_someone_elses_project(self):
        self.sent(self.run, lesson='Book the venue first.', cost_amount='4321', outcome='did_not_work')
        (row,) = self.lessons()
        self.assertEqual(set(row), {'lesson', 'closed_at', 'project'})
        self.assertEqual((row['lesson'], row['project']), ('Book the venue first.', None))
        self.assertNotIn('4321', str(row))

    def test_the_project_is_named_when_the_owner_is_on_it_anyway(self):
        mine = self.run_of(self.key, self.author)
        self.sent(mine, user=self.author, lesson='Mine.')
        self.assertEqual(self.lessons()[0]['project'], mine.name)

    def test_nothing_new_is_sent_and_the_old_tick_boxes_do_nothing(self):
        from .models import TemplateComment
        res = self.close(self.run, lesson='Start a week earlier.', lesson_to_owner=True, post_as_comment=True)
        self.assertEqual((res.data['lesson_to_owner'], res.data['posted_as_comment']), (False, False))
        self.assertEqual(self.lessons(), [])
        self.assertFalse(TemplateComment.objects.exists())

    def test_a_run_kept_out_of_the_record_sends_nothing(self):
        self.sent(self.run, lesson='From a confidential run.')
        self.as_(self.owner).patch(f'/api/projects/{self.run.id}/', {'count_in_track_record': False}, format='json')
        self.assertEqual(self.lessons(), [])

    def test_lessons_written_before_phase_b_stay_with_the_project(self):
        from importlib import import_module
        from django.apps import apps
        self.sent(self.run, lesson='Written when the dialog said it stays with the project.')
        import_module('projects.migrations.0012_closeout_lessons_and_origin').keep_earlier_lessons_private(apps, None)
        self.assertEqual(self.lessons(), [])

    def test_a_sent_lesson_is_not_published_until_it_is_saved_through_the_new_dialog(self):
        self.sent(self.run, lesson='Sent privately.')
        self.assertEqual(self.as_(self.stranger).get(f'/api/templates/{self.key}/').data['lessons_learned']['runs'], [])
        self.close(self.run, lesson='Sent privately.', lesson_public=True)
        self.assertEqual(len(self.as_(self.stranger).get(f'/api/templates/{self.key}/').data['lessons_learned']['runs']), 1)
        self.assertEqual(self.lessons(), [])                                # it moved; it is not in both places

    def test_the_project_names_its_template_only_if_you_can_still_see_it(self):
        one = self.as_(self.owner).get(f'/api/projects/{self.run.id}/').data['source_template']
        self.assertEqual(one, {'key': self.key, 'name': 'Shared plan', 'has_owner': True})
        self.as_(self.author).post(f'/api/templates/{self.key}/unpublish/')
        self.assertIsNone(self.as_(self.owner).get(f'/api/projects/{self.run.id}/').data['source_template']['name'])
        self.assertFalse(self.as_(self.owner).get(f'/api/projects/{self.project.id}/').data['source_template']['has_owner'])  # a built-in
        listed = self.as_(self.owner).get('/api/projects/').data
        self.assertTrue(all(p['source_template'] is None for p in listed))                 # never computed for the list


class LessonsLearned(SharedPlanCase):
    """Section 8 of the design: a typed lesson goes straight to the template's page."""

    def learned(self, user=None, key=None):
        res = self.as_(user or self.stranger).get(f'/api/templates/{key or self.key}/lessons-learned/')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def share(self, project, user=None, **answers):
        return self.close(project, user=user, lesson_public=True, **answers)

    def remove_url(self, lesson_id, key=None):
        return f'/api/templates/{key or self.key}/lessons-learned/{lesson_id}/remove/'

    def test_a_lesson_shows_with_how_the_run_went_the_month_and_who_wrote_it(self):
        self.share(self.run, lesson='Book the venue first.', outcome='did_not_work', cost_amount='4321')
        data = self.learned()
        (row,) = data['runs']
        self.assertEqual(set(row), {'id', 'text', 'outcome', 'month', 'author', 'is_mine'})
        self.assertEqual((row['text'], row['outcome'], row['author'], row['is_mine']),
                         ('Book the venue first.', 'did_not_work', 'olga', False))
        self.assertEqual(row['month'], timezone.now().strftime('%Y-%m'))
        self.assertEqual(data['total'], 1)
        self.assertEqual(self.as_(self.stranger).get(f'/api/templates/{self.key}/').data['lessons_learned'], data)

    def test_it_never_carries_a_project_a_closeout_id_or_a_cost(self):
        self.run.name = 'PROJECT-NAME-XYZ'
        self.run.save()
        self.share(self.run, lesson='Book the venue first.', cost_amount='4321', effort_person_days='77')
        closeout = RunCloseout.objects.get(project=self.run)
        row = self.learned()['runs'][0]
        self.assertNotIn(row['id'], (str(closeout.pk), str(self.run.pk)))
        flat = str(self.learned()) + str(self.as_(self.stranger).get(f'/api/templates/{self.key}/').data['lessons_learned'])
        for leak in ('PROJECT-NAME-XYZ', '4321', '77'):
            self.assertNotIn(leak, flat)

    def test_anonymous_means_nobody_is_told_not_the_owner_and_not_an_admin(self):
        self.share(self.run, lesson='Signed by nobody.', lesson_anonymous=True)
        for user in (self.stranger, self.author, self.staff, self.editor):
            self.assertIsNone(self.learned(user)['runs'][0]['author'], user.username)
            self.assertNotIn('olga', str(self.learned(user)))
        self.assertTrue(self.learned(self.owner)['runs'][0]['is_mine'])       # its writer still knows it is theirs
        self.share(self.run, lesson='Signed by nobody.', lesson_anonymous=False)
        self.assertEqual(self.learned()['runs'][0]['author'], 'olga')         # and can sign it later

    def test_a_lesson_that_was_not_saved_as_public_is_not_shown(self):
        self.close(self.run, lesson='Typed under the old wording.')
        self.assertEqual(self.learned()['runs'], [])

    def test_an_edited_cleared_deleted_or_opted_out_lesson_goes_at_once(self):
        self.share(self.run, lesson='First wording.')
        self.share(self.run, lesson='Second wording.')
        self.assertEqual([r['text'] for r in self.learned()['runs']], ['Second wording.'])
        self.share(self.run, lesson='')
        self.assertEqual(self.learned()['runs'], [])
        self.share(self.run, lesson='Back again.')
        self.as_(self.owner).patch(f'/api/projects/{self.run.id}/', {'count_in_track_record': False}, format='json')
        self.assertEqual(self.learned()['runs'], [])
        self.as_(self.owner).patch(f'/api/projects/{self.run.id}/', {'count_in_track_record': True}, format='json')
        self.assertEqual(len(self.learned()['runs']), 1)
        self.as_(self.owner).delete(f'/api/projects/{self.run.id}/closeout/')
        self.assertEqual(self.learned()['runs'], [])

    def test_newest_first_and_the_project_the_template_was_saved_from_counts(self):
        self.share(self.run, lesson='Older.')
        RunCloseout.objects.filter(project=self.run).update(closed_at=timezone.now() - timezone.timedelta(days=40))
        self.share(self.run_of(self.key, self.stranger), user=self.stranger, lesson='Newer.')
        self.assertEqual([r['text'] for r in self.learned()['runs']], ['Newer.', 'Older.'])
        self.share(self.project, lesson='From the run that made the plan.')
        key = self.as_(self.owner).post('/api/templates/', {'project': self.project.id, 'name': 'Mine'}, format='json').data['key']
        self.assertEqual([r['text'] for r in self.learned(self.owner, key)['runs']], ['From the run that made the plan.'])

    def test_only_people_who_can_see_the_template_can_read_them(self):
        self.share(self.run, lesson='Book the venue first.')
        self.as_(self.author).post(f'/api/templates/{self.key}/unpublish/')
        self.assertEqual(self.as_(self.stranger).get(f'/api/templates/{self.key}/lessons-learned/').status_code, 404)

    def test_the_owner_or_an_admin_can_take_a_lesson_down_and_nobody_else(self):
        self.share(self.run, lesson='Wrong about the venue.')
        lesson_id = self.learned()['runs'][0]['id']
        for user in (self.stranger, self.owner, self.editor):                 # not even its writer, from here
            self.assertEqual(self.as_(user).post(self.remove_url(lesson_id)).status_code, 403)
        self.assertEqual((self.learned(self.owner)['can_remove'], self.learned(self.author)['can_remove'],
                          self.learned(self.staff)['can_remove']), (False, True, True))
        res = self.as_(self.author).post(self.remove_url(lesson_id))
        self.assertEqual((res.status_code, res.data['runs']), (200, []))
        self.assertEqual(self.as_(self.author).post(self.remove_url(lesson_id)).status_code, 404)   # already down

    def test_a_lesson_taken_down_stays_on_its_project_and_stays_down(self):
        self.share(self.run, lesson='Wrong about the venue.')
        lesson_id = self.learned()['runs'][0]['id']
        self.assertEqual(self.as_(self.author).post(self.remove_url(lesson_id)).status_code, 200)
        mine = self.as_(self.owner).get(f'/api/projects/{self.run.id}/closeout/').data
        self.assertEqual((mine['lesson'], mine['lesson_removed']), ('Wrong about the venue.', True))
        self.share(self.run, lesson='Wrong about the venue, reworded.')
        self.assertEqual(self.learned()['runs'], [])

    def test_a_lesson_cannot_be_taken_down_or_reported_through_another_template(self):
        self.share(self.run, lesson='Book the venue first.')
        lesson_id = self.learned()['runs'][0]['id']
        other = ProjectTemplate.objects.create(owner=self.stranger, name='Other', visibility='instance', categories=[], tasks=[])
        self.assertEqual(self.as_(self.stranger).post(self.remove_url(lesson_id, f'saved:{other.id}')).status_code, 404)
        self.assertEqual(self.as_(self.stranger).post(f'/api/templates/saved:{other.id}/report/', {'lesson': lesson_id}, format='json').status_code, 404)
        self.assertEqual(len(self.learned()['runs']), 1)

    def test_built_in_templates_get_lessons_and_admins_look_after_them(self):
        self.share(self.project, lesson='Two weeks is short for this.', outcome='worked_with_changes')
        data = self.learned(key=KEY)
        self.assertEqual((data['runs'][0]['text'], data['can_add_notes'], data['can_remove']), ('Two weeks is short for this.', False, False))
        lesson_id = data['runs'][0]['id']
        self.assertEqual(self.as_(self.owner).post(self.remove_url(lesson_id, KEY)).status_code, 403)
        self.assertEqual(self.as_(self.owner).post(f'/api/templates/{KEY}/owner-notes/', {'text': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.as_(self.staff).post(self.remove_url(lesson_id, KEY)).data['runs'], [])

    def test_a_lesson_can_be_reported(self):
        from .models import TemplateReport
        self.share(self.run, lesson='Book the venue first.')
        lesson_id = self.learned()['runs'][0]['id']
        res = self.as_(self.stranger).post(f'/api/templates/{self.key}/report/', {'lesson': lesson_id, 'reason': 'Spam'}, format='json')
        self.assertEqual(res.status_code, 204)
        report = TemplateReport.objects.get()
        self.assertEqual((str(report.lesson_ref), report.template_key, report.reason), (lesson_id, self.key, 'Spam'))


class TheOwnersNotes(SharedPlanCase):
    def setUp(self):
        super().setUp()
        self.notes_url = f'/api/templates/{self.key}/owner-notes/'

    def add(self, text, user=None, **more):
        return self.as_(user or self.author).post(self.notes_url, {'text': text, **more}, format='json')

    def texts(self, user=None, key=None):
        data = self.as_(user or self.stranger).get(f'/api/templates/{key or self.key}/lessons-learned/').data
        return [n['text'] for n in data['notes']]

    def test_only_the_templates_owner_writes_them_and_everyone_reads_them(self):
        for user in (self.stranger, self.owner, self.staff):
            self.assertEqual(self.add('Not mine to write.', user).status_code, 403)
        self.assertEqual(self.add('Not a fit for a team under four.').status_code, 201)
        self.assertEqual(self.texts(), ['Not a fit for a team under four.'])
        note_id = self.as_(self.stranger).get(f'/api/templates/{self.key}/lessons-learned/').data['notes'][0]['id']
        for user in (self.stranger, self.staff):
            self.assertEqual(self.as_(user).patch(f'{self.notes_url}{note_id}/', {'text': 'Hijacked'}, format='json').status_code, 403)
            self.assertEqual(self.as_(user).delete(f'{self.notes_url}{note_id}/').status_code, 403)
        self.assertEqual(self.texts(), ['Not a fit for a team under four.'])

    def test_seven_at_most_and_three_hundred_characters(self):
        self.assertEqual(self.add('x' * 301).status_code, 400)
        self.assertEqual(self.add('   ').status_code, 400)
        for i in range(7):
            self.assertEqual(self.add(f'Note {i}').status_code, 201)
        self.assertEqual(self.add('One too many').status_code, 400)
        self.assertEqual(len(self.texts()), 7)

    def test_the_owner_orders_rewords_and_deletes_them(self):
        for text in ('A', 'B', 'C'):
            self.add(text)
        notes = self.as_(self.author).get(f'/api/templates/{self.key}/lessons-learned/').data['notes']
        self.as_(self.author).patch(f'{self.notes_url}{notes[2]["id"]}/', {'position': 0}, format='json')
        self.assertEqual(self.texts(), ['C', 'A', 'B'])
        self.as_(self.author).patch(f'{self.notes_url}{notes[0]["id"]}/', {'text': 'A, reworded'}, format='json')
        self.assertEqual(self.texts(), ['C', 'A, reworded', 'B'])
        self.as_(self.author).delete(f'{self.notes_url}{notes[1]["id"]}/')
        self.assertEqual(self.texts(), ['C', 'A, reworded'])

    def test_a_note_cannot_be_reached_through_another_template(self):
        self.add('Mine.')
        note_id = self.as_(self.author).get(f'/api/templates/{self.key}/lessons-learned/').data['notes'][0]['id']
        other = ProjectTemplate.objects.create(owner=self.stranger, name='Other', categories=[], tasks=[])
        res = self.as_(self.stranger).patch(f'/api/templates/saved:{other.id}/owner-notes/{note_id}/', {'text': 'Hijacked'}, format='json')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.texts(), ['Mine.'])

    def test_a_copy_starts_with_the_notes_and_not_with_what_runs_learned(self):
        self.add('Carry this over.')
        self.close(self.run, lesson='Stays with the original.', lesson_public=True)
        fork = self.as_(self.stranger).post(f'/api/templates/{self.key}/fork/').data
        self.assertEqual(([n['text'] for n in fork['lessons_learned']['notes']], fork['lessons_learned']['runs'],
                          fork['lessons_learned']['can_add_notes']), (['Carry this over.'], [], True))
        copied = fork['lessons_learned']['notes'][0]['id']
        self.as_(self.stranger).patch(f'/api/templates/{fork["key"]}/owner-notes/{copied}/', {'text': 'Changed in the copy.'}, format='json')
        self.assertEqual(self.texts(), ['Carry this over.'])                  # the original is untouched

    def test_they_go_when_the_template_is_deleted(self):
        from .models import TemplateOwnerNote
        self.add('Gone with it.')
        self.as_(self.author).delete(f'/api/templates/{self.key}/')
        self.assertFalse(TemplateOwnerNote.objects.exists())
