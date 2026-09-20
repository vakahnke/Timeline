"""The template library's security boundary and behaviour (docs/design/template-library.md).

The rule under test: a saved template is visible to its owner, to members of a team it is shared
with, and to everyone once published to the instance, and to nobody else. Every endpoint answers
"not yours to see" with the same 404 as "does not exist". Nothing the client sends is authority.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from events.models import Event

from .library import track_records
from .models import Project, ProjectTemplate, Team, TemplateComment, TemplateReport, TemplateVote

User = get_user_model()

TASKS = [
    {'title': 'Plan', 'category': 'Work', 'start_offset_minutes': 0, 'duration_minutes': 1440,
     'notes': 'call pat@example.com first', 'is_milestone': False, 'depends_on': [],
     'todos': [{'title': 'Book the room', 'due_offset_days': 1}]},
    {'title': 'Ship', 'category': 'Work', 'start_offset_minutes': 1440, 'duration_minutes': 1440,
     'notes': 'secret sauce', 'is_milestone': True, 'depends_on': [0], 'todos': []},
]


class LibraryCase(APITestCase):
    def setUp(self):
        cache.clear()                                   # throttle counters
        self.ann = User.objects.create_user('ann', 'ann@example.com', 'pw')      # the author
        self.bob = User.objects.create_user('bob', 'bob@example.com', 'pw')      # on Ann's team
        self.cat = User.objects.create_user('cat', 'cat@example.com', 'pw')      # a stranger
        self.staff = User.objects.create_user('sam', 'sam@example.com', 'pw', is_staff=True)
        self.team = Team.objects.create(name='Crew', owner=self.ann)
        self.team.members.add(self.bob)
        self.other_team = Team.objects.create(name='Elsewhere', owner=self.cat)
        self.tpl = ProjectTemplate.objects.create(
            owner=self.ann, name='Launch playbook', description='How we launch.',
            categories=[{'name': 'Work', 'color': '#4a88ff'}], tasks=TASKS)
        self.key = f'saved:{self.tpl.id}'
        self.url = f'/api/templates/{self.key}/'

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client

    def keys(self, user, **params):
        res = self.as_(user).get('/api/templates/', params)
        self.assertEqual(res.status_code, 200)
        return [t['key'] for t in res.data]

    def publish(self, visibility='instance', **extra):
        res = self.as_(self.ann).patch(self.url, {'visibility': visibility, **extra}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res


class VisibilityTests(LibraryCase):
    def test_private_by_default_and_invisible_to_everyone_else(self):
        self.assertIn(self.key, self.keys(self.ann))
        for user in (self.bob, self.cat, self.staff):
            self.assertNotIn(self.key, self.keys(user))

    def test_every_endpoint_404s_for_a_template_you_cannot_see(self):
        c = self.as_(self.cat)
        calls = [
            c.get(self.url), c.patch(self.url, {'name': 'x'}, format='json'), c.delete(self.url),
            c.post(self.url + 'vote/'), c.delete(self.url + 'vote/'),
            c.get(self.url + 'comments/'), c.post(self.url + 'comments/', {'body': 'hi'}, format='json'),
            c.post(self.url + 'fork/'), c.post(self.url + 'report/', {}, format='json'),
            c.post(self.url + 'unpublish/'),
        ]
        self.assertEqual([r.status_code for r in calls], [404] * len(calls))
        res = c.post('/api/templates/instantiate/', {'key': self.key, 'start': '2026-10-01T09:00:00Z'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Project.objects.exists())
        self.assertFalse(TemplateVote.objects.exists() or TemplateComment.objects.exists())

    def test_a_missing_template_looks_the_same_as_a_hidden_one(self):
        hidden = self.as_(self.cat).get(self.url)
        missing = self.as_(self.cat).get('/api/templates/saved:999999/')
        self.assertEqual((hidden.status_code, hidden.data), (missing.status_code, missing.data))

    def test_shared_with_a_team_reaches_its_members_only(self):
        self.publish('teams', shared_with_teams=[self.team.id])
        self.assertIn(self.key, self.keys(self.bob))
        self.assertNotIn(self.key, self.keys(self.cat))
        self.assertEqual(self.as_(self.bob).get(self.url).status_code, 200)

    def test_team_access_is_live(self):
        self.publish('teams', shared_with_teams=[self.team.id])
        self.team.members.remove(self.bob)
        self.assertNotIn(self.key, self.keys(self.bob))
        self.assertEqual(self.as_(self.bob).get(self.url).status_code, 404)

    def test_published_to_the_instance_reaches_everyone_signed_in(self):
        self.publish('instance')
        self.assertIn(self.key, self.keys(self.cat))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/templates/').status_code, 401)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_unpublishing_takes_it_back(self):
        self.publish('instance')
        self.assertEqual(self.as_(self.ann).post(self.url + 'unpublish/').status_code, 200)
        self.assertNotIn(self.key, self.keys(self.cat))

    def test_you_cannot_share_with_a_team_you_are_not_in(self):
        res = self.as_(self.ann).patch(self.url, {'visibility': 'teams',
                                                  'shared_with_teams': [self.other_team.id]}, format='json')
        self.assertEqual(res.status_code, 400)
        self.tpl.refresh_from_db()
        self.assertEqual(self.tpl.visibility, 'private')

    def test_sharing_with_teams_needs_a_team(self):
        res = self.as_(self.ann).patch(self.url, {'visibility': 'teams'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_operator_can_cap_sharing(self):
        with override_settings(TEMPLATE_LIBRARY='teams'):
            res = self.as_(self.ann).patch(self.url, {'visibility': 'instance'}, format='json')
            self.assertEqual(res.status_code, 400)
        self.publish('instance')
        with override_settings(TEMPLATE_LIBRARY='teams'):       # already published: hidden again
            self.assertNotIn(self.key, self.keys(self.cat))
        with override_settings(TEMPLATE_LIBRARY='off'):
            self.assertNotIn(self.key, self.keys(self.cat))
            self.assertIn(self.key, self.keys(self.ann))


class AuthorityTests(LibraryCase):
    def test_only_the_owner_edits_publishes_or_deletes(self):
        self.publish('instance')
        for user in (self.cat, self.staff):
            c = self.as_(user)
            self.assertEqual(c.patch(self.url, {'name': 'Mine now'}, format='json').status_code, 403)
            self.assertEqual(c.patch(self.url, {'visibility': 'private'}, format='json').status_code, 403)
            self.assertEqual(c.delete(self.url).status_code, 404)
        self.tpl.refresh_from_db()
        self.assertEqual((self.tpl.name, self.tpl.visibility), ('Launch playbook', 'instance'))

    def test_client_cannot_name_itself_the_owner(self):
        self.publish('instance')
        self.as_(self.cat).patch(self.url, {'owner': self.cat.id, 'is_mine': True}, format='json')
        self.tpl.refresh_from_db()
        self.assertEqual(self.tpl.owner_id, self.ann.id)

    def test_staff_can_unpublish_but_a_stranger_cannot(self):
        self.publish('instance')
        self.assertEqual(self.as_(self.cat).post(self.url + 'unpublish/').status_code, 403)
        self.assertEqual(self.as_(self.staff).post(self.url + 'unpublish/').status_code, 204)
        self.tpl.refresh_from_db()
        self.assertEqual(self.tpl.visibility, 'private')

    def test_staff_never_see_private_templates(self):
        self.assertEqual(self.as_(self.staff).get(self.url).status_code, 404)


class PrivacyTests(LibraryCase):
    def test_notes_and_todos_can_be_held_back_from_everyone_but_the_owner(self):
        self.publish('instance', share_notes=False, share_todos=False)
        theirs = self.as_(self.cat).get(self.url).data['tasks']
        self.assertEqual([t['notes'] for t in theirs], ['', ''])
        self.assertEqual([t['todos'] for t in theirs], [[], []])
        mine = self.as_(self.ann).get(self.url).data['tasks']
        self.assertEqual(mine[0]['notes'], 'call pat@example.com first')
        self.tpl.refresh_from_db()
        self.assertEqual(self.tpl.tasks[1]['notes'], 'secret sauce')           # nothing destroyed

    def test_held_back_text_does_not_leak_through_a_copy_or_a_project(self):
        self.publish('instance', share_notes=False, share_todos=False)
        fork = self.as_(self.cat).post(self.url + 'fork/')
        self.assertEqual(fork.status_code, 201)
        copy = ProjectTemplate.objects.get(pk=fork.data['id'])
        self.assertEqual((copy.owner_id, copy.visibility, copy.forked_from_key), (self.cat.id, 'private', self.key))
        self.assertNotIn('secret', str(copy.tasks))
        res = self.as_(self.cat).post('/api/templates/instantiate/',
                                      {'key': self.key, 'start': '2026-10-01T09:00:00Z'}, format='json')
        self.assertEqual(res.status_code, 201)
        project = Project.objects.get(pk=res.data['id'])
        self.assertEqual(set(project.events.values_list('notes', flat=True)), {''})
        self.assertFalse(project.events.filter(tasks__isnull=False).exists())

    def test_author_can_publish_without_their_name(self):
        self.publish('instance', author_display='anonymous')
        self.assertIsNone(self.as_(self.cat).get(self.url).data['author'])
        self.assertEqual(self.as_(self.ann).get(self.url).data['author'], 'ann')
        self.publish('instance', author_display='name')
        self.assertEqual(self.as_(self.cat).get(self.url).data['author'], 'ann')

    def test_sharing_settings_are_shown_only_to_the_owner(self):
        self.publish('teams', shared_with_teams=[self.team.id])
        self.assertNotIn('shared_with_teams', self.as_(self.bob).get(self.url).data)
        self.assertEqual(self.as_(self.ann).get(self.url).data['shared_with_teams'], [self.team.id])

    def test_fork_origin_is_named_only_if_you_can_see_it(self):
        self.publish('instance')
        fork_key = self.as_(self.cat).post(self.url + 'fork/').data['key']
        self.assertEqual(self.as_(self.cat).get(f'/api/templates/{fork_key}/').data['forked_from']['name'],
                         'Launch playbook')
        self.as_(self.ann).post(self.url + 'unpublish/')
        self.assertIsNone(self.as_(self.cat).get(f'/api/templates/{fork_key}/').data['forked_from'])


class VoteAndCommentTests(LibraryCase):
    def test_one_vote_per_person_and_it_can_be_taken_back(self):
        self.publish('instance')
        c = self.as_(self.cat)
        c.post(self.url + 'vote/')
        res = c.post(self.url + 'vote/')
        self.assertEqual((res.data['votes'], res.data['voted']), (1, True))
        self.assertEqual(self.as_(self.bob).post(self.url + 'vote/').data['votes'], 2)
        res = self.as_(self.cat).delete(self.url + 'vote/')
        self.assertEqual((res.data['votes'], res.data['voted']), (1, False))

    def test_builtins_can_be_voted_and_commented_on(self):
        c = self.as_(self.cat)
        self.assertEqual(c.post('/api/templates/builtin:sprint/vote/').data['votes'], 1)
        self.assertEqual(c.post('/api/templates/builtin:sprint/comments/', {'body': 'Solid.'}, format='json').status_code, 201)
        self.assertEqual(c.get('/api/templates/builtin:sprint/').data['comment_count'], 1)

    def test_comment_moderation(self):
        self.publish('instance')
        mk = lambda u, body: self.as_(u).post(self.url + 'comments/', {'body': body}, format='json').data['id']
        by_cat, by_bob, third = mk(self.cat, 'Worked for us'), mk(self.bob, 'Too long'), mk(self.bob, 'Third')
        url = lambda i: f'{self.url}comments/{i}/'
        self.assertEqual(self.as_(self.bob).delete(url(by_cat)).status_code, 403)       # not yours
        self.assertEqual(self.as_(self.bob).patch(url(by_cat), {'body': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.as_(self.ann).patch(url(by_cat), {'body': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.as_(self.cat).patch(url(by_cat), {'body': 'Edited'}, format='json').status_code, 200)
        self.assertEqual(self.as_(self.ann).delete(url(by_cat)).status_code, 204)       # template owner
        self.assertEqual(self.as_(self.staff).delete(url(by_bob)).status_code, 204)     # staff
        self.assertEqual(self.as_(self.bob).delete(url(third)).status_code, 204)        # author
        self.assertEqual(self.as_(self.cat).post(self.url + 'comments/', {'body': '   '}, format='json').status_code, 400)

    def test_a_comment_id_from_another_template_does_not_resolve(self):
        self.publish('instance')
        other = TemplateComment.objects.create(template_key='builtin:sprint', author=self.bob, body='elsewhere')
        self.assertEqual(self.as_(self.ann).delete(f'{self.url}comments/{other.id}/').status_code, 404)

    def test_reporting_files_a_flag_for_staff(self):
        self.publish('instance')
        res = self.as_(self.cat).post(self.url + 'report/', {'reason': 'Contains a phone number'}, format='json')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(TemplateReport.objects.get().template_key, self.key)

    def test_deleting_a_template_takes_its_votes_and_comments(self):
        self.publish('instance')
        self.as_(self.cat).post(self.url + 'vote/')
        self.as_(self.cat).post(self.url + 'comments/', {'body': 'hi'}, format='json')
        self.assertEqual(self.as_(self.ann).delete(self.url).status_code, 204)
        self.assertFalse(TemplateVote.objects.exists() or TemplateComment.objects.exists())


class SearchTests(LibraryCase):
    def test_search_filter_and_scope(self):
        self.publish('instance', summary='Ship without drama', group='work', tags=['Launch', 'launch', ' SaaS '])
        self.tpl.refresh_from_db()
        self.assertEqual(self.tpl.tags, ['Launch', 'SaaS'])
        self.assertEqual(self.keys(self.cat, q='drama'), [self.key])
        self.assertEqual(self.keys(self.cat, tag='saas'), [self.key])
        self.assertIn(self.key, self.keys(self.cat, group='work'))
        self.assertNotIn(self.key, self.keys(self.cat, group='hobby'))
        self.assertEqual(self.keys(self.ann, scope='mine'), [self.key])
        self.assertEqual(self.keys(self.cat, scope='shared'), [self.key])
        self.assertEqual(self.keys(self.cat, scope='mine'), [])

    def test_older_bare_ids_still_work(self):
        self.assertEqual(self.as_(self.ann).delete(f'/api/templates/{self.tpl.id}/').status_code, 204)


class TrackRecordTests(LibraryCase):
    def run_it(self, user, *, days, done, key=None, ends_ago=0):
        """A project started from the template that took ``days`` and is ``done``% complete."""
        res = self.as_(user).post('/api/templates/instantiate/',
                                  {'key': key or self.key, 'start': '2026-01-05T09:00:00Z'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        project = Project.objects.get(pk=res.data['id'])
        end = timezone.now() - timedelta(days=ends_ago)
        first, last = project.events.order_by('start')
        Event.objects.filter(pk=first.pk).update(start=end - timedelta(days=days), end=end - timedelta(days=days / 2))
        Event.objects.filter(pk=last.pk).update(start=end - timedelta(days=days / 2), end=end)
        project.events.update(percent_complete=done)
        return project

    def test_provenance_is_recorded(self):
        project = self.run_it(self.ann, days=2, done=0)
        self.assertEqual((project.source_template_key, project.source_template_span), (self.key, 2880))
        self.assertEqual(self.as_(self.ann).get(f'/api/projects/{project.id}/').data['source_template_key'], self.key)

    def test_counts_and_the_minimum_before_a_ratio_is_shown(self):
        self.publish('instance')
        self.run_it(self.ann, days=2, done=100)
        self.run_it(self.bob, days=3, done=100)
        self.run_it(self.cat, days=2, done=40)                  # in flight
        self.run_it(self.cat, days=2, done=40, ends_ago=90)     # abandoned
        rec = self.as_(self.cat).get(self.url).data['track_record']
        self.assertEqual((rec['started'], rec['finished'], rec['in_flight'], rec['abandoned']), (4, 2, 1, 1))
        self.assertIsNone(rec['typical_ratio'])                 # two finished runs: not enough
        self.run_it(self.cat, days=4, done=100)
        rec = self.as_(self.cat).get(self.url).data['track_record']
        self.assertEqual(rec['finished'], 3)
        self.assertAlmostEqual(rec['typical_ratio'], 1.5, places=2)     # median of 1.0, 1.5, 2.0

    def test_an_owner_can_keep_a_run_out_of_the_record(self):
        project = self.run_it(self.ann, days=2, done=100)
        url = f'/api/projects/{project.id}/'
        self.assertEqual(self.as_(self.ann).patch(url, {'count_in_track_record': False}, format='json').status_code, 200)
        self.assertEqual(track_records([self.key])[self.key]['started'], 0)

    def test_only_an_owner_can_change_that(self):
        from .models import ProjectMembership
        project = self.run_it(self.ann, days=2, done=100)
        ProjectMembership.objects.create(project=project, user=self.bob, role='editor')
        res = self.as_(self.bob).patch(f'/api/projects/{project.id}/', {'count_in_track_record': False}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_the_record_never_names_projects(self):
        self.publish('instance')
        self.run_it(self.ann, days=2, done=100)
        body = str(self.as_(self.cat).get(self.url).data['track_record'])
        self.assertNotIn('Launch playbook', body)
        self.assertEqual(set(self.as_(self.cat).get(self.url).data['track_record']),
                         {'started', 'finished', 'in_flight', 'abandoned', 'typical_ratio', 'min_finished_runs',
                          'stopped', 'closed', 'outcomes', 'cost', 'effort'})       # totals, every one

    def test_proven_sort_puts_finished_plans_first(self):
        self.publish('instance')
        for _ in range(2):
            self.run_it(self.ann, days=2, done=100)
        self.assertEqual(self.keys(self.cat)[0], self.key)
