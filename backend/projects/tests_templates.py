"""Admin-only deletion (retirement) of built-in project templates.

Built-in templates live in code (templates_builtin.py), so "deleting" one records a
HiddenBuiltinTemplate row that hides it globally. Runs against the isolated test DB.
"""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import HiddenBuiltinTemplate, ProjectTemplate
from .templates_builtin import BUILTIN_TEMPLATES

User = get_user_model()

# A stable built-in slug to exercise.
SLUG = 'sprint'
KEY = f'builtin:{SLUG}'


class BuiltinTemplateDeletionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user('admin', 'admin@example.com', 'pw', is_staff=True)
        self.member = User.objects.create_user('member', 'member@example.com', 'pw')

    def _keys(self):
        res = self.client.get('/api/templates/')
        self.assertEqual(res.status_code, 200)
        return {t['key'] for t in res.data}

    def test_me_exposes_is_staff(self):
        self.client.force_authenticate(self.admin)
        self.assertTrue(self.client.get('/api/me/').data['is_staff'])
        self.client.force_authenticate(self.member)
        self.assertFalse(self.client.get('/api/me/').data['is_staff'])

    def test_builtins_listed_by_default(self):
        self.client.force_authenticate(self.member)
        self.assertIn(KEY, self._keys())

    def test_non_admin_cannot_delete_builtin(self):
        self.client.force_authenticate(self.member)
        res = self.client.delete(f'/api/templates/{SLUG}/')
        self.assertEqual(res.status_code, 403)
        self.assertFalse(HiddenBuiltinTemplate.objects.exists())
        self.assertIn(KEY, self._keys())                 # still there

    def test_admin_deletes_builtin_globally(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'/api/templates/{SLUG}/')
        self.assertEqual(res.status_code, 204)
        self.assertTrue(HiddenBuiltinTemplate.objects.filter(slug=SLUG, hidden_by=self.admin).exists())

        # Gone for the admin and for everyone else.
        self.assertNotIn(KEY, self._keys())
        self.client.force_authenticate(self.member)
        self.assertNotIn(KEY, self._keys())

    def test_deleting_is_idempotent(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f'/api/templates/{SLUG}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/templates/{SLUG}/').status_code, 204)
        self.assertEqual(HiddenBuiltinTemplate.objects.filter(slug=SLUG).count(), 1)

    def test_retired_builtin_cannot_be_instantiated(self):
        self.client.force_authenticate(self.admin)
        self.client.delete(f'/api/templates/{SLUG}/')
        res = self.client.post('/api/templates/instantiate/',
                               {'key': KEY, 'start': '2026-07-01T09:00:00Z'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_admin_delete_unknown_slug_is_404(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete('/api/templates/not_a_real_slug/')
        self.assertEqual(res.status_code, 404)
        self.assertFalse(HiddenBuiltinTemplate.objects.exists())

    def test_saved_template_deletion_still_owner_scoped(self):
        mine = ProjectTemplate.objects.create(owner=self.member, name='Mine', categories=[], tasks=[])
        theirs = ProjectTemplate.objects.create(owner=self.admin, name='Theirs', categories=[], tasks=[])
        self.client.force_authenticate(self.member)
        # Can't delete someone else's saved template.
        self.assertEqual(self.client.delete(f'/api/templates/{theirs.id}/').status_code, 404)
        self.assertTrue(ProjectTemplate.objects.filter(id=theirs.id).exists())
        # Can delete my own.
        self.assertEqual(self.client.delete(f'/api/templates/{mine.id}/').status_code, 204)
        self.assertFalse(ProjectTemplate.objects.filter(id=mine.id).exists())

    def test_every_builtin_slug_is_non_numeric(self):
        # destroy() routes numeric pk -> saved, non-numeric -> built-in slug; a numeric
        # slug would collide and silently break that dispatch.
        for slug in BUILTIN_TEMPLATES:
            self.assertFalse(slug.isdigit(), slug)
