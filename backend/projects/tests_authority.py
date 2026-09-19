"""The server decides who may do what; the client never does.

Every check here sends the API something a hostile or buggy client might send, such as a role in
the body, an is_admin flag, another user's id as author, or a tampered token, and asserts that
authority still comes only from the caller's token plus their CURRENT membership in the database.
"""
import base64
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from events.models import Comment, Event, StatusReport, Task
from projects.models import Project, ProjectMembership, ProjectTeam, Role, Team

User = get_user_model()
CLAIMS = {'role': 'owner', 'my_role': 'owner', 'is_admin': True, 'is_staff': True, 'is_superuser': True, 'is_org_admin': True}


class _Base(TestCase):
    def setUp(self):
        mk = lambda n: User.objects.create_user(n, f'{n}@example.com', 'a-real-Passw0rd')
        self.owner, self.editor, self.viewer, self.outsider = mk('owner'), mk('editor'), mk('viewer'), mk('outsider')
        self.project = Project.objects.create(name='Apollo', owner=self.owner)
        self.other = Project.objects.create(name='Someone else’s', owner=self.outsider)
        ProjectMembership.objects.create(project=self.other, user=self.outsider, role=Role.OWNER)
        for u, r in ((self.owner, Role.OWNER), (self.editor, Role.EDITOR), (self.viewer, Role.VIEWER)):
            ProjectMembership.objects.create(project=self.project, user=u, role=r)
        now = timezone.now()
        self.event = Event.objects.create(project=self.project, title='Build', category='Build', start=now, end=now + timedelta(days=2))
        self.base = f'/api/projects/{self.project.id}'

    def as_(self, user, **headers):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}', **headers)
        return c


class ClientSuppliedAuthorityIsIgnored(_Base):
    def test_a_viewer_cannot_write_by_claiming_a_role_in_the_body(self):
        c = self.as_(self.viewer)
        body = {'title': 'x', 'category': 'Build', 'start': timezone.now().isoformat(), 'end': (timezone.now() + timedelta(days=1)).isoformat(), **CLAIMS}
        self.assertEqual(c.post(f'{self.base}/events/', body, format='json').status_code, 403)
        self.assertEqual(c.patch(f'{self.base}/events/{self.event.id}/', {'title': 'pwned', **CLAIMS}, format='json').status_code, 403)
        self.assertEqual(c.patch(f'{self.base}/', {'name': 'pwned', **CLAIMS}, format='json').status_code, 403)
        self.assertEqual(c.delete(f'{self.base}/').status_code, 403)
        self.event.refresh_from_db(); self.project.refresh_from_db()
        self.assertEqual((self.event.title, self.project.name), ('Build', 'Apollo'))

    def test_role_headers_and_query_strings_mean_nothing(self):
        c = self.as_(self.viewer, HTTP_X_ROLE='owner', HTTP_X_IS_ADMIN='true', HTTP_X_USER_ID=str(self.owner.id))
        self.assertEqual(c.patch(f'{self.base}/events/{self.event.id}/?role=owner&is_admin=1', {'title': 'pwned'}, format='json').status_code, 403)

    def test_nobody_can_promote_themselves(self):
        mine = ProjectMembership.objects.get(project=self.project, user=self.editor)
        c = self.as_(self.editor)
        self.assertEqual(c.patch(f'{self.base}/members/{mine.id}/', {'role': 'owner'}, format='json').status_code, 403)
        self.assertEqual(c.post(f'{self.base}/members/', {'identifier': 'editor', 'role': 'owner'}, format='json').status_code, 403)
        self.assertIn(self.as_(self.outsider).post(f'{self.base}/members/', {'identifier': 'outsider', 'role': 'owner'}, format='json').status_code, (403, 404))
        mine.refresh_from_db()
        self.assertEqual(mine.role, Role.EDITOR)
        self.assertFalse(ProjectMembership.objects.filter(project=self.project, user=self.outsider).exists())

    def test_the_project_in_the_url_wins_over_a_project_in_the_body(self):
        body = {'title': 'planted', 'category': 'x', 'start': timezone.now().isoformat(), 'end': (timezone.now() + timedelta(days=1)).isoformat(),
                'project': self.other.id, 'project_id': self.other.id}
        r = self.as_(self.editor).post(f'{self.base}/events/', body, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Event.objects.get(id=r.json()['id']).project_id, self.project.id)
        self.assertFalse(Event.objects.filter(project=self.other).exists())

    def test_another_projects_objects_cannot_be_reached_through_my_project(self):
        theirs = Event.objects.create(project=self.other, title='Secret', category='x', start=timezone.now(), end=timezone.now() + timedelta(days=1))
        c = self.as_(self.owner)
        self.assertEqual(c.get(f'{self.base}/events/{theirs.id}/').status_code, 404)
        self.assertEqual(c.patch(f'{self.base}/events/{theirs.id}/', {'title': 'pwned'}, format='json').status_code, 404)
        self.assertEqual(c.get(f'{self.base}/events/{theirs.id}/tasks/').status_code, 404)
        self.assertEqual(c.patch(f'{self.base}/events/{self.event.id}/', {'depends_on': [theirs.id]}, format='json').status_code, 400)

    def test_identity_fields_come_from_the_token_not_the_body(self):
        c = self.as_(self.editor)
        r = c.post(f'{self.base}/events/{self.event.id}/comments/', {'body': 'hi', 'author': self.owner.id, 'author_id': self.owner.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Comment.objects.get(id=r.json()['id']).author_id, self.editor.id)
        r = c.post(f'{self.base}/status-reports/', {'as_of': timezone.now().isoformat(), 'status': 'on_track', 'content': {}, 'snapshot': {},
                                                   'author': self.owner.id, 'project': self.other.id}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        saved = StatusReport.objects.get(id=r.json()['id'])
        self.assertEqual((saved.author_id, saved.project_id), (self.editor.id, self.project.id))
        r = c.post(f'{self.base}/baselines/', {'name': 'v1', 'created_by': self.owner.id, 'active': False, 'events': {'999': {}}}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['created_by_name'], 'editor')

    @override_settings(REQUIRE_ACCOUNT_APPROVAL=True)
    def test_registration_cannot_grant_itself_anything(self):
        r = APIClient().post('/api/auth/register/', {'username': 'mallory', 'email': 'm@example.com', 'password': 'a-real-Passw0rd-9',
                                                     'is_staff': True, 'is_superuser': True, 'is_active': True, 'groups': [1]}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        u = User.objects.get(username='mallory')
        self.assertEqual((u.is_staff, u.is_superuser, u.is_active), (False, False, False))

    def test_profile_is_read_only(self):
        c = self.as_(self.viewer)
        self.assertIn(c.patch('/api/me/', {'is_staff': True}, format='json').status_code, (405, 403))
        self.viewer.refresh_from_db()
        self.assertFalse(self.viewer.is_staff)

    def test_a_tampered_token_is_rejected_not_believed(self):
        token = str(AccessToken.for_user(self.viewer))
        head, payload, sig = token.split('.')
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        claims.update({'user_id': str(self.owner.id), **CLAIMS})
        forged = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b'=').decode()
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f'Bearer {head}.{forged}.{sig}')
        self.assertEqual(c.get(f'{self.base}/events/').status_code, 401)
        extra = AccessToken.for_user(self.viewer); extra['role'] = 'owner'; extra['is_staff'] = True      # validly signed, extra claims
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {extra}')
        self.assertEqual(c.patch(f'{self.base}/events/{self.event.id}/', {'title': 'pwned'}, format='json').status_code, 403)


class MembershipIsReadLiveOnEveryRequest(_Base):
    def test_demotion_and_removal_take_effect_on_the_very_next_request_with_the_same_token(self):
        c = self.as_(self.editor)
        url = f'{self.base}/events/{self.event.id}/'
        self.assertEqual(c.patch(url, {'title': 'ok'}, format='json').status_code, 200)
        m = ProjectMembership.objects.get(project=self.project, user=self.editor)
        m.role = Role.VIEWER; m.save()
        self.assertEqual(c.patch(url, {'title': 'no'}, format='json').status_code, 403)
        self.assertEqual(c.get(url).status_code, 200)
        m.delete()
        self.assertEqual(c.get(url).status_code, 403)
        self.assertEqual(c.get(f'{self.base}/').status_code, 404)
        self.assertNotIn(self.project.id, [p['id'] for p in c.get('/api/projects/').json()])

    def test_group_access_is_live_too_and_the_highest_grant_wins(self):
        team = Team.objects.create(name='Crew', owner=self.owner)
        team.members.add(self.outsider)
        ProjectTeam.objects.create(project=self.project, team=team, role=Role.EDITOR, added_by=self.owner)
        c = self.as_(self.outsider)
        url = f'{self.base}/events/{self.event.id}/'
        self.assertEqual(c.patch(url, {'title': 'via team'}, format='json').status_code, 200)
        self.assertEqual(c.delete(f'{self.base}/').status_code, 403)                    # a group grants Editor, never Owner
        team.members.remove(self.outsider)
        self.assertEqual(c.get(url).status_code, 403)

    def test_losing_staff_status_ends_org_admin_access_at_once(self):
        self.outsider.is_staff = True; self.outsider.save()
        c = self.as_(self.outsider)
        self.assertEqual(c.get(f'{self.base}/events/').status_code, 200)
        self.outsider.is_staff = False; self.outsider.save()
        self.assertEqual(c.get(f'{self.base}/events/').status_code, 403)


class PeopleOnTasksMustBeOnTheProject(_Base):
    def test_a_task_cannot_be_owned_by_or_assigned_to_someone_without_access(self):
        c = self.as_(self.editor)
        url = f'{self.base}/events/{self.event.id}/tasks/'
        for field in ('assignee_identifier', 'owner_identifier'):
            r = c.post(url, {'title': 't', field: 'outsider'}, format='json')
            self.assertEqual(r.status_code, 400, (field, r.content))
        ok = c.post(url, {'title': 't', 'assignee_identifier': 'viewer@example.com'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(c.patch(f"{url}{ok.json()['id']}/", {'assignee_identifier': 'outsider'}, format='json').status_code, 400)
        self.assertFalse(Task.objects.filter(assignee=self.outsider).exists())


class AccountStateIsLiveToo(_Base):
    def test_a_deactivated_account_is_locked_out_immediately_even_with_a_valid_token(self):
        c = self.as_(self.editor)
        self.assertEqual(c.get(f'{self.base}/events/').status_code, 200)
        self.editor.is_active = False; self.editor.save()
        self.assertEqual(c.get(f'{self.base}/events/').status_code, 401)

    def test_my_tasks_follows_the_same_access_rules_including_teams(self):
        team = Team.objects.create(name='Crew', owner=self.owner)
        team.members.add(self.outsider)
        ProjectTeam.objects.create(project=self.project, team=team, role=Role.EDITOR, added_by=self.owner)
        Task.objects.create(event=self.event, title='Via team', owner=self.owner, assignee=self.outsider)
        c = self.as_(self.outsider)
        self.assertEqual([t['title'] for t in c.get('/api/me/tasks/').json()], ['Via team'])
        team.members.remove(self.outsider)
        self.assertEqual(c.get('/api/me/tasks/').json(), [])
