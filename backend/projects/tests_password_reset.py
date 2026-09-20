import re
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()
REQUEST, CONFIRM = '/api/auth/password-reset/', '/api/auth/password-reset/confirm/'
NEW = 'a-Much-better-Passw0rd'


@override_settings(SITE_URL='https://timeline.example.com', DEFAULT_FROM_EMAIL='Timeline <no-reply@example.com>')
class PasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()                                            # throttle counters live in the cache
        self.user = User.objects.create_user('pm', 'pm@example.com', 'the-old-Passw0rd')
        self.pending = User.objects.create_user('newbie', 'newbie@example.com', 'the-old-Passw0rd', is_active=False)
        self.c = APIClient()

    def link(self):
        body = mail.outbox[-1].body
        q = parse_qs(urlparse(re.search(r'https://\S+', body).group(0)).query)
        return q['uid'][0], q['token'][0]

    def test_known_and_unknown_addresses_get_the_same_answer(self):
        known = self.c.post(REQUEST, {'email': 'PM@example.com'}, format='json')
        unknown = self.c.post(REQUEST, {'email': 'nobody@example.com'}, format='json')
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(known.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)                    # only the real account was mailed
        self.assertEqual(mail.outbox[0].to, ['pm@example.com'])
        self.assertIn('https://timeline.example.com/reset-password?uid=', mail.outbox[0].body)
        self.assertIn('one hour', mail.outbox[0].body)

    def test_an_account_awaiting_approval_cannot_reset(self):
        self.assertEqual(self.c.post(REQUEST, {'email': 'newbie@example.com'}, format='json').status_code, 200)
        self.assertEqual(mail.outbox, [])

    def test_the_whole_flow_changes_the_password_and_does_not_sign_in(self):
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        self.assertEqual(self.c.post(CONFIRM, {'uid': uid, 'token': token}, format='json').status_code, 200)   # link check only
        r = self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': NEW}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertNotIn('access', r.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW))
        self.assertEqual(self.c.post('/api/auth/token/', {'username': 'pm', 'password': NEW}, format='json').status_code, 200)
        self.assertEqual(self.c.post('/api/auth/token/', {'username': 'pm', 'password': 'the-old-Passw0rd'}, format='json').status_code, 401)
        self.assertEqual(mail.outbox[-1].subject, f'Your {settings.APP_NAME} password was changed')

    def test_a_link_works_once(self):
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        self.assertEqual(self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': NEW}, format='json').status_code, 200)
        again = self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': 'Another-g00d-one!'}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json()['code'], 'bad_link')

    def test_a_link_expires(self):
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        with override_settings(PASSWORD_RESET_TIMEOUT=-1):
            self.assertEqual(self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': NEW}, format='json').status_code, 400)

    def test_forged_and_malformed_links_are_refused_the_same_way(self):
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        for bad in ({'uid': uid, 'token': token[:-1] + ('a' if token[-1] != 'a' else 'b')}, {'uid': 'not-base64!!', 'token': token},
                    {'uid': 'OTk5OTk5', 'token': token}, {'uid': '', 'token': ''}, {}):
            r = self.c.post(CONFIRM, {**bad, 'new_password': NEW}, format='json')
            self.assertEqual((r.status_code, r.json().get('code')), (400, 'bad_link'), bad)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('the-old-Passw0rd'))

    def test_password_rules_are_enforced_and_the_link_survives_a_rejected_password(self):
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        weak = self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': '12345678'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertIn('new_password', weak.json())
        self.assertEqual(self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': NEW}, format='json').status_code, 200)

    def test_every_other_session_is_signed_out(self):
        refresh = str(RefreshToken.for_user(self.user))
        self.assertEqual(self.c.post('/api/auth/token/refresh/', {'refresh': refresh}, format='json').status_code, 200)
        refresh2 = str(RefreshToken.for_user(self.user))
        self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json')
        uid, token = self.link()
        self.c.post(CONFIRM, {'uid': uid, 'token': token, 'new_password': NEW}, format='json')
        self.assertEqual(self.c.post('/api/auth/token/refresh/', {'refresh': refresh2}, format='json').status_code, 401)

    def test_requests_are_throttled_per_address_and_per_caller(self):
        codes = [self.c.post(REQUEST, {'email': 'pm@example.com'}, format='json').status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])            # 3 an hour to one inbox
        self.assertEqual(len(mail.outbox), 3)
        cache.clear()
        codes = [self.c.post(REQUEST, {'email': f'x{i}@example.com'}, format='json').status_code for i in range(6)]
        self.assertEqual(codes, [200] * 5 + [429])               # 5 an hour from one caller

    def test_guessing_links_is_throttled(self):
        codes = [self.c.post(CONFIRM, {'uid': 'x', 'token': 'y', 'new_password': NEW}, format='json').status_code for _ in range(11)]
        self.assertEqual(codes, [400] * 10 + [429])

    def test_a_signed_in_token_is_not_needed_and_not_consulted(self):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Bearer not-a-real-token')
        self.assertEqual(c.post(REQUEST, {'email': 'pm@example.com'}, format='json').status_code, 200)
