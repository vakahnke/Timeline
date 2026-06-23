"""Team visibility: members can see (read-only) the teams they belong to, but only the
owner may modify them. Runs against the test database."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Team

User = get_user_model()


class TeamVisibilityTests(APITestCase):
    def setUp(self):
        self.owner   = User.objects.create_user('owner',   'owner@x.com',   'pw')
        self.member  = User.objects.create_user('member',  'member@x.com',  'pw')
        self.outsider = User.objects.create_user('outsider', 'outsider@x.com', 'pw')
        self.team = Team.objects.create(name='Squad', owner=self.owner)
        self.team.members.add(self.member)

    def url(self):         return f'/api/teams/{self.team.id}/'
    def members_url(self): return f'/api/teams/{self.team.id}/members/'

    # ── Visibility ────────────────────────────────────────────────────────────
    def test_member_sees_team_in_list_readonly(self):
        self.client.force_authenticate(self.member)
        res = self.client.get('/api/teams/')
        self.assertEqual(res.status_code, 200)
        row = next((t for t in res.data if t['id'] == self.team.id), None)
        self.assertIsNotNone(row, 'a member should see the team they were added to')
        self.assertFalse(row['is_owner'])

    def test_owner_sees_team_as_owner(self):
        self.client.force_authenticate(self.owner)
        row = next(t for t in self.client.get('/api/teams/').data if t['id'] == self.team.id)
        self.assertTrue(row['is_owner'])

    def test_outsider_cannot_see_team(self):
        self.client.force_authenticate(self.outsider)
        self.assertNotIn(self.team.id, [t['id'] for t in self.client.get('/api/teams/').data])
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_member_can_retrieve_team(self):
        self.client.force_authenticate(self.member)
        res = self.client.get(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual({u['username'] for u in res.data['members']}, {'member'})

    # ── Member is read-only ───────────────────────────────────────────────────
    def test_member_cannot_modify_team(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.patch(self.url(), {'name': 'Hijacked'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(self.members_url(), {'identifier': 'outsider'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'{self.members_url()}{self.member.id}/').status_code, 403)
        self.assertEqual(self.client.delete(self.url()).status_code, 403)
        self.team.refresh_from_db()
        self.assertEqual(self.team.name, 'Squad')                       # unchanged
        self.assertTrue(Team.objects.filter(id=self.team.id).exists())  # not deleted

    # ── Owner retains full control (regression) ───────────────────────────────
    def test_owner_can_manage_team(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(self.url(), {'name': 'Renamed'}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.members_url(), {'identifier': 'outsider'}, format='json').status_code, 200)
        self.assertTrue(self.team.members.filter(id=self.outsider.id).exists())
        self.assertEqual(self.client.delete(self.url()).status_code, 204)

    def test_any_user_can_create_a_team(self):
        self.client.force_authenticate(self.member)
        res = self.client.post('/api/teams/', {'name': 'My Own'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['is_owner'])
