"""Account approval + email-or-username sign-in.

Runs against the isolated test database (never the dev data) and uses the in-memory
email backend so no mail is actually sent.
"""
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from rest_framework.test import APITestCase

from .emails import notify_user_account_activated

User = get_user_model()

SETTINGS = dict(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    ACCOUNT_NOTIFY_EMAIL='operator@example.com',
    REQUIRE_ACCOUNT_APPROVAL=True,
    DEFAULT_FROM_EMAIL='Timeline <no-reply@example.com>',
)


@override_settings(**SETTINGS)
class AccountApprovalTests(APITestCase):
    def _register(self, username='alice', email='alice@example.com', password='s3curePa55!'):
        return self.client.post('/api/auth/register/',
                                {'username': username, 'email': email, 'password': password},
                                format='json')

    def test_registration_creates_inactive_user_and_emails_operator(self):
        mail.outbox = []
        res = self._register()
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.data['is_active'])              # frontend reads this -> shows "pending"
        user = User.objects.get(username='alice')
        self.assertFalse(user.is_active)
        self.assertEqual(len(mail.outbox), 1)                # operator notified
        self.assertIn('operator@example.com', mail.outbox[0].to)
        self.assertIn('pending approval', mail.outbox[0].subject.lower())

    def test_inactive_user_cannot_get_token_and_sees_pending_message(self):
        self._register()
        res = self.client.post('/api/auth/token/',
                               {'username': 'alice', 'password': 's3curePa55!'}, format='json')
        self.assertEqual(res.status_code, 401)
        self.assertIn('awaiting approval', str(res.data.get('detail', '')).lower())

    def test_wrong_password_does_not_reveal_pending_status(self):
        self._register()
        res = self.client.post('/api/auth/token/',
                               {'username': 'alice', 'password': 'wrong-password'}, format='json')
        self.assertEqual(res.status_code, 401)
        self.assertNotIn('awaiting approval', str(res.data.get('detail', '')).lower())

    def test_after_approval_can_sign_in_by_username_and_by_email(self):
        self._register()
        user = User.objects.get(username='alice')
        user.is_active = True
        user.save(update_fields=['is_active'])

        by_username = self.client.post('/api/auth/token/',
                                       {'username': 'alice', 'password': 's3curePa55!'}, format='json')
        self.assertEqual(by_username.status_code, 200)
        self.assertIn('access', by_username.data)

        by_email = self.client.post('/api/auth/token/',
                                    {'username': 'ALICE@example.com', 'password': 's3curePa55!'},
                                    format='json')
        self.assertEqual(by_email.status_code, 200)          # case-insensitive email login
        self.assertIn('access', by_email.data)

    def test_activation_email_goes_to_the_user(self):
        self._register()
        user = User.objects.get(username='alice')
        mail.outbox = []
        self.assertTrue(notify_user_account_activated(user))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('alice@example.com', mail.outbox[0].to)
        self.assertIn('ready', mail.outbox[0].subject.lower())


@override_settings(**SETTINGS)
class LogoutBlacklistTests(APITestCase):
    def setUp(self):
        # create_user defaults to active, so this account can sign in directly.
        User.objects.create_user('carol', 'carol@example.com', 's3curePa55!')

    def _login(self):
        res = self.client.post('/api/auth/token/',
                               {'username': 'carol', 'password': 's3curePa55!'}, format='json')
        return res.data['access'], res.data['refresh']

    def test_logout_blacklists_refresh_token(self):
        _, refresh = self._login()
        out = self.client.post('/api/auth/logout/', {'refresh': refresh}, format='json')
        self.assertEqual(out.status_code, 200)
        # The refresh token is now dead — it can no longer mint access tokens.
        again = self.client.post('/api/auth/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(again.status_code, 401)

    def test_logout_is_idempotent_for_garbage_tokens(self):
        out = self.client.post('/api/auth/logout/', {'refresh': 'not-a-real-token'}, format='json')
        self.assertEqual(out.status_code, 200)

    def test_rotated_away_refresh_token_is_revoked(self):
        _, refresh1 = self._login()
        rot = self.client.post('/api/auth/token/refresh/', {'refresh': refresh1}, format='json')
        self.assertEqual(rot.status_code, 200)
        refresh2 = rot.data['refresh']
        # The old refresh token can't be reused after rotation...
        reuse = self.client.post('/api/auth/token/refresh/', {'refresh': refresh1}, format='json')
        self.assertEqual(reuse.status_code, 401)
        # ...but the new one works.
        ok = self.client.post('/api/auth/token/refresh/', {'refresh': refresh2}, format='json')
        self.assertEqual(ok.status_code, 200)


@override_settings(**{**SETTINGS, 'REQUIRE_ACCOUNT_APPROVAL': False})
class ApprovalDisabledTests(APITestCase):
    def test_registration_is_active_when_approval_disabled(self):
        res = self.client.post('/api/auth/register/',
                               {'username': 'bob', 'email': 'bob@example.com',
                                'password': 's3curePa55!'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data['is_active'])
        token = self.client.post('/api/auth/token/',
                                 {'username': 'bob', 'password': 's3curePa55!'}, format='json')
        self.assertEqual(token.status_code, 200)             # can sign in immediately
